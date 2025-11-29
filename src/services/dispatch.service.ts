/**
 * Dispatch Service
 *
 * Auto-dispatch brain that:
 * 1. Finds available ambulances
 * 2. Filters by capability hierarchy (RRV < BLS < ALS < CCT)
 * 3. Calculates ETA for each candidate
 * 4. Assigns the best unit and triggers simulation
 */

import { prisma, AmbulanceStatus, AmbulanceType } from "../shared/store/prisma";
import { routingService, type Coordinates } from "./routing.service";
import { destinationService, type Severity } from "./destination.service";
import { simulationService } from "./simulation.service";

// ============ Types ============

export interface DispatchRequest {
  incidentId: string;
  lat: number;
  lng: number;
  requiredType?: AmbulanceType;
  severity?: Severity;
  triageType?: string;
}

export interface DispatchResult {
  success: boolean;
  ambulanceId?: number;
  ambulanceCallsign?: string;
  ambulanceType?: AmbulanceType;
  etaSeconds?: number;
  distanceMeters?: number;
  route?: {
    type: "LineString";
    coordinates: [number, number][];
  };
  message: string;
}

export interface AmbulanceCandidate {
  id: number;
  callsign: string;
  type: AmbulanceType;
  lat: number;
  lng: number;
  hospitalId: number;
  etaSeconds: number;
  distanceMeters: number;
}

// ============ Constants ============

/**
 * Ambulance type hierarchy (higher index = higher capability)
 * RRV (0) < BLS (1) < ALS (2) < CCT (3)
 */
const TYPE_HIERARCHY: Record<AmbulanceType, number> = {
  RRV: 0, // Rapid Response Vehicle
  BLS: 1, // Basic Life Support
  ALS: 2, // Advanced Life Support
  CCT: 3, // Critical Care Transport
};

// ============ Service ============

class DispatchService {
  /**
   * Dispatch an ambulance to an incident
   *
   * @param request - Dispatch request with incident details
   * @returns Dispatch result with assigned ambulance info
   */
  async dispatchToIncident(request: DispatchRequest): Promise<DispatchResult> {
    const { incidentId, lat, lng, requiredType, severity, triageType } =
      request;

    console.log(`\n🚨 Dispatch Request for Incident ${incidentId}`);
    console.log(`   📍 Location: ${lat}, ${lng}`);
    console.log(`   🏥 Required Type: ${requiredType || "Any"}`);
    console.log(`   ⚠️ Severity: ${severity || "Unknown"}`);

    const incidentLocation: Coordinates = { lat, lng };

    // Step 1: Fetch all IDLE ambulances
    const idleAmbulances = await prisma.ambulance.findMany({
      where: { status: AmbulanceStatus.IDLE },
      include: { hospital: true },
    });

    console.log(`   🚑 Found ${idleAmbulances.length} IDLE ambulances`);

    if (idleAmbulances.length === 0) {
      return {
        success: false,
        message: "No available ambulances",
      };
    }

    // Step 2: Filter by capability hierarchy
    const validAmbulances = this.filterByCapability(
      idleAmbulances,
      requiredType
    );

    console.log(
      `   ✅ ${validAmbulances.length} ambulances meet capability requirements`
    );

    if (validAmbulances.length === 0) {
      return {
        success: false,
        message: `No ambulances with required capability (${
          requiredType || "Any"
        }) available`,
      };
    }

    // Step 3: Calculate ETA for each candidate
    const candidates: AmbulanceCandidate[] = validAmbulances.map(
      (ambulance) => {
        const ambulanceLocation: Coordinates = {
          lat: ambulance.currentLat,
          lng: ambulance.currentLng,
        };
        const route = routingService.calculateMockRoute(
          ambulanceLocation,
          incidentLocation
        );

        return {
          id: ambulance.id,
          callsign: ambulance.callsign,
          type: ambulance.type,
          lat: ambulance.currentLat,
          lng: ambulance.currentLng,
          hospitalId: ambulance.hospitalId,
          etaSeconds: route.etaSeconds,
          distanceMeters: route.distanceMeters,
        };
      }
    );

    // Step 4: Sort by lowest ETA
    candidates.sort((a, b) => a.etaSeconds - b.etaSeconds);

    const bestCandidate = candidates[0];
    if (!bestCandidate) {
      return {
        success: false,
        message: "No valid candidates found after filtering",
      };
    }

    console.log(
      `   🏆 Best candidate: ${bestCandidate.callsign} (ETA: ${bestCandidate.etaSeconds}s)`
    );

    // Step 5: Assign in database
    await prisma.ambulance.update({
      where: { id: bestCandidate.id },
      data: { status: AmbulanceStatus.EN_ROUTE },
    });

    console.log(
      `   ✅ Ambulance ${bestCandidate.callsign} assigned and set to EN_ROUTE`
    );

    // Generate route geometry
    const route = routingService.calculateMockRoute(
      { lat: bestCandidate.lat, lng: bestCandidate.lng },
      incidentLocation
    );

    // Step 6: Trigger the simulation (non-blocking)
    this.startSimulation(
      bestCandidate.id,
      incidentId,
      { lat: bestCandidate.lat, lng: bestCandidate.lng },
      incidentLocation,
      severity || "LOW",
      bestCandidate.type,
      triageType
    );

    return {
      success: true,
      ambulanceId: bestCandidate.id,
      ambulanceCallsign: bestCandidate.callsign,
      ambulanceType: bestCandidate.type,
      etaSeconds: bestCandidate.etaSeconds,
      distanceMeters: bestCandidate.distanceMeters,
      route: route.geometry,
      message: `Ambulance ${bestCandidate.callsign} dispatched`,
    };
  }

  /**
   * Filter ambulances by capability hierarchy
   * If ALS is required, only ALS or CCT are valid
   */
  private filterByCapability(
    ambulances: Array<{
      id: number;
      callsign: string;
      type: AmbulanceType;
      status: AmbulanceStatus;
      currentLat: number;
      currentLng: number;
      hospitalId: number;
    }>,
    requiredType?: AmbulanceType
  ) {
    if (!requiredType) {
      // No specific type required - all ambulances are valid
      return ambulances;
    }

    const requiredLevel = TYPE_HIERARCHY[requiredType];

    // Filter to ambulances at or above the required level
    return ambulances.filter((ambulance) => {
      const ambulanceLevel = TYPE_HIERARCHY[ambulance.type];
      return ambulanceLevel >= requiredLevel;
    });
  }

  /**
   * Start the simulation in the background (non-blocking)
   */
  private startSimulation(
    ambulanceId: number,
    incidentId: string,
    ambulanceLocation: Coordinates,
    incidentLocation: Coordinates,
    severity: Severity,
    ambulanceType: AmbulanceType,
    triageType?: string
  ): void {
    // Use setImmediate to ensure this doesn't block the response
    setImmediate(async () => {
      try {
        await simulationService.startLifecycle({
          ambulanceId,
          incidentId,
          ambulanceLocation,
          incidentLocation,
          severity,
          ambulanceType,
          triageType,
        });
      } catch (error) {
        console.error(`❌ Simulation error for incident ${incidentId}:`, error);
      }
    });
  }

  /**
   * Get all dispatch candidates for an incident (for preview/debugging)
   */
  async getCandidates(
    lat: number,
    lng: number,
    requiredType?: AmbulanceType
  ): Promise<AmbulanceCandidate[]> {
    const incidentLocation: Coordinates = { lat, lng };

    const idleAmbulances = await prisma.ambulance.findMany({
      where: { status: AmbulanceStatus.IDLE },
    });

    const validAmbulances = this.filterByCapability(
      idleAmbulances,
      requiredType
    );

    const candidates: AmbulanceCandidate[] = validAmbulances.map(
      (ambulance) => {
        const route = routingService.calculateMockRoute(
          { lat: ambulance.currentLat, lng: ambulance.currentLng },
          incidentLocation
        );

        return {
          id: ambulance.id,
          callsign: ambulance.callsign,
          type: ambulance.type,
          lat: ambulance.currentLat,
          lng: ambulance.currentLng,
          hospitalId: ambulance.hospitalId,
          etaSeconds: route.etaSeconds,
          distanceMeters: route.distanceMeters,
        };
      }
    );

    candidates.sort((a, b) => a.etaSeconds - b.etaSeconds);

    return candidates;
  }
}

// Export singleton instance
export const dispatchService = new DispatchService();
