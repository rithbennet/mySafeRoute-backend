/**
 * Simulation Service
 *
 * Real-time lifecycle simulator for ambulance dispatch
 * Uses setInterval to animate ambulance movement along actual routes
 *
 * Phases:
 * 1. Outbound: Ambulance -> Incident (follows route, duration = ETA)
 * 2. On Scene: Pause at incident (3 seconds)
 * 3. Decision: Find best hospital and calculate route
 * 4. Inbound: Incident -> Hospital (follows route, duration = ETA)
 * 5. Complete: Ambulance parks at hospital, status = IDLE
 */

import { prisma, AmbulanceStatus } from "../shared/store/prisma";
import { destinationService, type Severity } from "./destination.service";
import { routingService, type Coordinates } from "./routing.service";
import { getRoutingProvider } from "../modules/routing/RoutingAdapter";
import { broadcastToDispatchers } from "../modules/telemetry/WebSocketService";
import type { AmbulanceType } from "../../generated/prisma/client";

// ============ Types ============

export interface SimulationConfig {
  ambulanceId: number;
  incidentId: string;
  ambulanceLocation: Coordinates;
  incidentLocation: Coordinates;
  severity: Severity;
  ambulanceType: AmbulanceType;
  triageType?: string;
  /** Pre-calculated route from ambulance to incident (if available) */
  outboundRoute?: {
    coordinates: [number, number][];
    etaSeconds: number;
    distanceMeters: number;
  };
}

export type SimulationPhase =
  | "OUTBOUND" // Moving to incident
  | "ON_SCENE" // At incident location
  | "DECISION" // Selecting hospital
  | "INBOUND" // Moving to hospital
  | "COMPLETE"; // Arrived at hospital, mission complete

interface ActiveSimulation {
  config: SimulationConfig;
  phase: SimulationPhase;
  progress: number;
  intervalId: ReturnType<typeof setInterval> | null;
  hospitalDestination?: Coordinates;
  hospitalId?: number;
  hospitalName?: string;
  /** Route coordinates for current phase */
  routeCoordinates?: [number, number][];
  /** ETA in seconds for current movement phase */
  phaseEtaSeconds?: number;
}

// ============ Constants ============

/** Duration for on-scene phase in milliseconds */
const ON_SCENE_DURATION = 3000; // 3 seconds on scene

/** Update interval in milliseconds */
const UPDATE_INTERVAL = 1000; // 1 second

/** Minimum phase duration in seconds (for very short routes) */
const MIN_PHASE_DURATION_SECONDS = 5;

/** Speed multiplier for demo (1 = real-time, 2 = 2x faster, etc.) */
const SIMULATION_SPEED_MULTIPLIER = 1;

// ============ Service ============

class SimulationService {
  /** Map of active simulations by incident ID */
  private activeSimulations: Map<string, ActiveSimulation> = new Map();

  /**
   * Start the ambulance lifecycle simulation
   */
  async startLifecycle(config: SimulationConfig): Promise<void> {
    console.log(`\n🎬 Starting simulation for Incident ${config.incidentId}`);
    console.log(`   Ambulance ID: ${config.ambulanceId}`);

    // Check if simulation already exists
    if (this.activeSimulations.has(config.incidentId)) {
      console.log(
        `   ⚠️ Simulation already running for incident ${config.incidentId}`
      );
      return;
    }

    // Create simulation state
    const simulation: ActiveSimulation = {
      config,
      phase: "OUTBOUND",
      progress: 0,
      intervalId: null,
    };

    this.activeSimulations.set(config.incidentId, simulation);

    // Start the outbound phase
    await this.startOutboundPhase(simulation);
  }

  /**
   * Phase 1: Outbound - Move ambulance from current position to incident
   * Now follows actual route geometry from routing API
   */
  private async startOutboundPhase(
    simulation: ActiveSimulation
  ): Promise<void> {
    console.log(`   📍 Phase: OUTBOUND`);

    const { config } = simulation;
    simulation.phase = "OUTBOUND";
    simulation.progress = 0;

    // Get route - use pre-calculated if available, otherwise fetch
    let routeCoordinates: [number, number][];
    let etaSeconds: number;

    if (config.outboundRoute && config.outboundRoute.coordinates.length > 1) {
      // Use pre-calculated route from dispatch
      routeCoordinates = config.outboundRoute.coordinates;
      etaSeconds = config.outboundRoute.etaSeconds;
      console.log(
        `   📍 Using pre-calculated route (${routeCoordinates.length} points, ETA: ${etaSeconds}s)`
      );
    } else {
      // Fetch route from routing API
      try {
        const routingProvider = getRoutingProvider("google");
        const route = await routingProvider.getRoute(
          {
            lat: config.ambulanceLocation.lat,
            lng: config.ambulanceLocation.lng,
          },
          { lat: config.incidentLocation.lat, lng: config.incidentLocation.lng }
        );
        routeCoordinates = route.geometry.coordinates as [number, number][];
        etaSeconds = route.etaSeconds;
        console.log(
          `   📍 Fetched route from API (${routeCoordinates.length} points, ETA: ${etaSeconds}s)`
        );
      } catch (error) {
        console.warn(`   ⚠️ Route API failed, using straight line:`, error);
        // Fallback to detailed straight line
        const fallbackRoute = routingService.generateDetailedLineString(
          config.ambulanceLocation,
          config.incidentLocation,
          20
        );
        routeCoordinates = fallbackRoute.coordinates as [number, number][];
        etaSeconds = routingService.calculateETA(
          config.ambulanceLocation,
          config.incidentLocation
        );
      }
    }

    // Store route data in simulation state
    simulation.routeCoordinates = routeCoordinates;
    simulation.phaseEtaSeconds = Math.max(
      etaSeconds,
      MIN_PHASE_DURATION_SECONDS
    );

    // Update ambulance status in database
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: { status: AmbulanceStatus.EN_ROUTE },
    });

    // Broadcast initial status with route
    broadcastToDispatchers({
      type: "AMBULANCE_UPDATE",
      id: config.ambulanceId,
      lat: config.ambulanceLocation.lat,
      lng: config.ambulanceLocation.lng,
      status: "EN_ROUTE",
      phase: simulation.phase,
      route: { type: "LineString", coordinates: routeCoordinates },
      etaSeconds: simulation.phaseEtaSeconds,
      timestamp: new Date().toISOString(),
    });

    // Calculate simulation timing
    const effectiveEta =
      simulation.phaseEtaSeconds / SIMULATION_SPEED_MULTIPLIER;
    const totalSteps = Math.ceil((effectiveEta * 1000) / UPDATE_INTERVAL);
    let currentStep = 0;

    console.log(`   ⏱️ Outbound: ${totalSteps} steps over ${effectiveEta}s`);

    simulation.intervalId = setInterval(async () => {
      currentStep++;
      simulation.progress = Math.min(currentStep / totalSteps, 1);

      // Get position along the actual route polyline
      const currentPosition = routingService.getPositionAlongPolyline(
        simulation.routeCoordinates!,
        simulation.progress
      );

      // Update database
      await prisma.ambulance.update({
        where: { id: config.ambulanceId },
        data: {
          currentLat: currentPosition.lat,
          currentLng: currentPosition.lng,
        },
      });

      // Broadcast position update
      this.broadcastAmbulanceUpdate(
        config.ambulanceId,
        currentPosition,
        "EN_ROUTE",
        simulation.phase
      );

      // Check if phase complete
      if (currentStep >= totalSteps) {
        if (simulation.intervalId) {
          clearInterval(simulation.intervalId);
          simulation.intervalId = null;
        }
        await this.startOnScenePhase(simulation);
      }
    }, UPDATE_INTERVAL);
  }

  /**
   * Phase 2: On Scene - Pause at incident location
   */
  private async startOnScenePhase(simulation: ActiveSimulation): Promise<void> {
    console.log(`   🏥 Phase: ON_SCENE`);

    const { config } = simulation;
    simulation.phase = "ON_SCENE";
    simulation.progress = 0;

    // Update ambulance status
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: { status: AmbulanceStatus.ON_SCENE },
    });

    // Broadcast status update
    this.broadcastAmbulanceUpdate(
      config.ambulanceId,
      config.incidentLocation,
      "ON_SCENE",
      simulation.phase
    );

    // Wait on scene
    setTimeout(async () => {
      await this.startDecisionPhase(simulation);
    }, ON_SCENE_DURATION);
  }

  /**
   * Phase 3: Decision - Find best hospital
   */
  private async startDecisionPhase(
    simulation: ActiveSimulation
  ): Promise<void> {
    console.log(`   🤔 Phase: DECISION`);

    const { config } = simulation;
    simulation.phase = "DECISION";

    // Find best hospital
    const hospital = await destinationService.findBestHospital(
      config.incidentLocation.lat,
      config.incidentLocation.lng,
      config.severity,
      config.ambulanceType,
      config.triageType
    );

    if (!hospital) {
      console.log(`   ❌ No suitable hospital found, ending simulation`);
      await this.endSimulation(simulation, config.incidentLocation);
      return;
    }

    // Store hospital info
    simulation.hospitalDestination = { lat: hospital.lat, lng: hospital.lng };
    simulation.hospitalId = hospital.id;
    simulation.hospitalName = hospital.name;

    console.log(`   🏥 Selected hospital: ${hospital.name}`);

    // Broadcast hospital selection
    broadcastToDispatchers({
      type: "HOSPITAL_SELECTED",
      incidentId: config.incidentId,
      ambulanceId: config.ambulanceId,
      hospital: {
        id: hospital.id,
        name: hospital.name,
        lat: hospital.lat,
        lng: hospital.lng,
      },
      etaSeconds: hospital.etaSeconds,
    });

    // Start inbound phase
    await this.startInboundPhase(simulation);
  }

  /**
   * Phase 4: Inbound - Move ambulance from incident to hospital
   * Now follows actual route geometry from routing API
   */
  private async startInboundPhase(simulation: ActiveSimulation): Promise<void> {
    console.log(`   🚗 Phase: INBOUND`);

    const { config } = simulation;
    simulation.phase = "INBOUND";
    simulation.progress = 0;

    if (!simulation.hospitalDestination) {
      console.log(`   ❌ No hospital destination, ending simulation`);
      await this.endSimulation(simulation, config.incidentLocation);
      return;
    }

    // Fetch route from incident to hospital
    let routeCoordinates: [number, number][];
    let etaSeconds: number;

    try {
      const routingProvider = getRoutingProvider("google");
      const route = await routingProvider.getRoute(
        { lat: config.incidentLocation.lat, lng: config.incidentLocation.lng },
        {
          lat: simulation.hospitalDestination.lat,
          lng: simulation.hospitalDestination.lng,
        }
      );
      routeCoordinates = route.geometry.coordinates as [number, number][];
      etaSeconds = route.etaSeconds;
      console.log(
        `   📍 Fetched inbound route (${routeCoordinates.length} points, ETA: ${etaSeconds}s)`
      );
    } catch (error) {
      console.warn(
        `   ⚠️ Route API failed for inbound, using straight line:`,
        error
      );
      // Fallback to detailed straight line
      const fallbackRoute = routingService.generateDetailedLineString(
        config.incidentLocation,
        simulation.hospitalDestination,
        20
      );
      routeCoordinates = fallbackRoute.coordinates as [number, number][];
      etaSeconds = routingService.calculateETA(
        config.incidentLocation,
        simulation.hospitalDestination
      );
    }

    // Store route data in simulation state
    simulation.routeCoordinates = routeCoordinates;
    simulation.phaseEtaSeconds = Math.max(
      etaSeconds,
      MIN_PHASE_DURATION_SECONDS
    );

    // Update ambulance status
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: { status: AmbulanceStatus.TRANSPORTING },
    });

    // Broadcast status update with route
    broadcastToDispatchers({
      type: "AMBULANCE_UPDATE",
      id: config.ambulanceId,
      lat: config.incidentLocation.lat,
      lng: config.incidentLocation.lng,
      status: "TRANSPORTING",
      phase: simulation.phase,
      route: { type: "LineString", coordinates: routeCoordinates },
      destination: {
        id: simulation.hospitalId,
        name: simulation.hospitalName,
        lat: simulation.hospitalDestination.lat,
        lng: simulation.hospitalDestination.lng,
      },
      etaSeconds: simulation.phaseEtaSeconds,
      timestamp: new Date().toISOString(),
    });

    // Calculate simulation timing
    const effectiveEta =
      simulation.phaseEtaSeconds / SIMULATION_SPEED_MULTIPLIER;
    const totalSteps = Math.ceil((effectiveEta * 1000) / UPDATE_INTERVAL);
    let currentStep = 0;

    console.log(`   ⏱️ Inbound: ${totalSteps} steps over ${effectiveEta}s`);

    simulation.intervalId = setInterval(async () => {
      currentStep++;
      simulation.progress = Math.min(currentStep / totalSteps, 1);

      // Get position along the actual route polyline
      const currentPosition = routingService.getPositionAlongPolyline(
        simulation.routeCoordinates!,
        simulation.progress
      );

      // Update database
      await prisma.ambulance.update({
        where: { id: config.ambulanceId },
        data: {
          currentLat: currentPosition.lat,
          currentLng: currentPosition.lng,
        },
      });

      // Broadcast position update
      this.broadcastAmbulanceUpdate(
        config.ambulanceId,
        currentPosition,
        "TRANSPORTING",
        simulation.phase
      );

      // Check if phase complete
      if (currentStep >= totalSteps) {
        if (simulation.intervalId) {
          clearInterval(simulation.intervalId);
          simulation.intervalId = null;
        }
        await this.completeSimulation(simulation);
      }
    }, UPDATE_INTERVAL);
  }

  /**
   * Phase 5: Complete - Ambulance arrives at hospital
   */
  private async completeSimulation(
    simulation: ActiveSimulation
  ): Promise<void> {
    console.log(`   ✅ Phase: COMPLETE`);

    const { config } = simulation;
    simulation.phase = "COMPLETE";

    // Update ambulance - park at hospital
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: {
        status: AmbulanceStatus.IDLE,
        currentLat:
          simulation.hospitalDestination?.lat ?? config.incidentLocation.lat,
        currentLng:
          simulation.hospitalDestination?.lng ?? config.incidentLocation.lng,
        hospitalId: simulation.hospitalId ?? undefined,
      },
    });

    // Broadcast completion
    this.broadcastAmbulanceUpdate(
      config.ambulanceId,
      simulation.hospitalDestination ?? config.incidentLocation,
      "IDLE",
      "COMPLETE"
    );

    broadcastToDispatchers({
      type: "SIMULATION_COMPLETE",
      incidentId: config.incidentId,
      ambulanceId: config.ambulanceId,
      hospitalId: simulation.hospitalId,
      hospitalName: simulation.hospitalName,
    });

    console.log(`   🎉 Simulation complete for Incident ${config.incidentId}`);

    // Clean up
    this.activeSimulations.delete(config.incidentId);
  }

  /**
   * End simulation early (error case)
   */
  private async endSimulation(
    simulation: ActiveSimulation,
    finalPosition: Coordinates
  ): Promise<void> {
    const { config } = simulation;

    // Clear any running intervals
    if (simulation.intervalId) {
      clearInterval(simulation.intervalId);
    }

    // Reset ambulance to IDLE
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: {
        status: AmbulanceStatus.IDLE,
        currentLat: finalPosition.lat,
        currentLng: finalPosition.lng,
      },
    });

    this.broadcastAmbulanceUpdate(
      config.ambulanceId,
      finalPosition,
      "IDLE",
      "COMPLETE"
    );

    this.activeSimulations.delete(config.incidentId);
  }

  /**
   * Broadcast ambulance update to all connected dispatchers
   */
  private broadcastAmbulanceUpdate(
    ambulanceId: number,
    location: Coordinates,
    status: string,
    phase: SimulationPhase
  ): void {
    broadcastToDispatchers({
      type: "AMBULANCE_UPDATE",
      id: ambulanceId,
      lat: location.lat,
      lng: location.lng,
      status,
      phase,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get status of a simulation
   */
  getSimulationStatus(incidentId: string): ActiveSimulation | undefined {
    return this.activeSimulations.get(incidentId);
  }

  /**
   * Cancel a running simulation
   */
  async cancelSimulation(incidentId: string): Promise<boolean> {
    const simulation = this.activeSimulations.get(incidentId);
    if (!simulation) {
      return false;
    }

    // Clear interval
    if (simulation.intervalId) {
      clearInterval(simulation.intervalId);
    }

    // Reset ambulance
    await prisma.ambulance.update({
      where: { id: simulation.config.ambulanceId },
      data: { status: AmbulanceStatus.IDLE },
    });

    this.activeSimulations.delete(incidentId);

    broadcastToDispatchers({
      type: "SIMULATION_CANCELLED",
      incidentId,
      ambulanceId: simulation.config.ambulanceId,
    });

    return true;
  }

  /**
   * Get count of active simulations
   */
  getActiveCount(): number {
    return this.activeSimulations.size;
  }
}

// Export singleton instance
export const simulationService = new SimulationService();
