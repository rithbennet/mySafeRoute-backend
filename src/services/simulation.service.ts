/**
 * Simulation Service
 *
 * Real-time lifecycle simulator for ambulance dispatch
 * Uses setInterval to animate ambulance movement and status changes
 *
 * Phases:
 * 1. Outbound: Ambulance -> Incident (10 seconds)
 * 2. On Scene: Pause at incident (3 seconds)
 * 3. Decision: Find best hospital
 * 4. Inbound: Incident -> Hospital (10 seconds)
 * 5. Complete: Ambulance parks at hospital, status = IDLE
 */

import { prisma, AmbulanceStatus } from "../shared/store/prisma";
import { destinationService, type Severity } from "./destination.service";
import { routingService, type Coordinates } from "./routing.service";
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
}

// ============ Constants ============

/** Duration for each phase in milliseconds */
const PHASE_DURATIONS = {
  OUTBOUND: 10000, // 10 seconds to reach incident
  ON_SCENE: 3000, // 3 seconds on scene
  INBOUND: 10000, // 10 seconds to reach hospital
};

/** Update interval in milliseconds */
const UPDATE_INTERVAL = 1000; // 1 second

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
   */
  private async startOutboundPhase(
    simulation: ActiveSimulation
  ): Promise<void> {
    console.log(`   📍 Phase: OUTBOUND`);

    const { config } = simulation;
    simulation.phase = "OUTBOUND";
    simulation.progress = 0;

    // Update ambulance status in database
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: { status: AmbulanceStatus.EN_ROUTE },
    });

    // Broadcast initial status
    this.broadcastAmbulanceUpdate(
      config.ambulanceId,
      config.ambulanceLocation,
      "EN_ROUTE",
      simulation.phase
    );

    const totalSteps = PHASE_DURATIONS.OUTBOUND / UPDATE_INTERVAL;
    let currentStep = 0;

    simulation.intervalId = setInterval(async () => {
      currentStep++;
      simulation.progress = currentStep / totalSteps;

      // Interpolate position
      const currentPosition = routingService.interpolatePosition(
        config.ambulanceLocation,
        config.incidentLocation,
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
    }, PHASE_DURATIONS.ON_SCENE);
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

    // Update ambulance status
    await prisma.ambulance.update({
      where: { id: config.ambulanceId },
      data: { status: AmbulanceStatus.TRANSPORTING },
    });

    // Broadcast status update
    this.broadcastAmbulanceUpdate(
      config.ambulanceId,
      config.incidentLocation,
      "TRANSPORTING",
      simulation.phase
    );

    const totalSteps = PHASE_DURATIONS.INBOUND / UPDATE_INTERVAL;
    let currentStep = 0;

    simulation.intervalId = setInterval(async () => {
      currentStep++;
      simulation.progress = currentStep / totalSteps;

      // Interpolate position
      const currentPosition = routingService.interpolatePosition(
        config.incidentLocation,
        simulation.hospitalDestination!,
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
