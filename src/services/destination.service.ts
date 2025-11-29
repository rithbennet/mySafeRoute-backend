/**
 * Destination Service
 *
 * Smart hospital selection based on:
 * - Incident severity (HIGH/LOW)
 * - Required ambulance type (ALS/CCT needs specialized hospitals)
 * - Hospital capabilities
 * - Distance to incident
 */

import { prisma } from "../shared/store/prisma";
import { routingService, type Coordinates } from "./routing.service";
import type { AmbulanceType } from "../../generated/prisma/client";

// ============ Types ============

export type Severity = "HIGH" | "LOW";

export interface HospitalResult {
  id: number;
  name: string;
  lat: number;
  lng: number;
  capabilities: string[];
  distanceMeters: number;
  etaSeconds: number;
}

// ============ Constants ============

/**
 * Capabilities required for high-severity or specialized cases
 */
const SPECIALIZED_CAPABILITIES = ["PCI", "TRAUMA", "STROKE", "NEURO", "BURNS"];

/**
 * Mapping of ambulance types to required hospital capabilities
 */
const AMBULANCE_TYPE_CAPABILITY_MAP: Record<string, string[]> = {
  CCT: ["PCI", "TRAUMA", "NEURO", "BURNS"], // Critical Care needs specialized
  ALS: ["PCI", "TRAUMA", "STROKE"], // Advanced Life Support
  BLS: [], // Basic Life Support - any hospital
  RRV: [], // Rapid Response - any hospital
};

/**
 * Triage to capability mapping
 */
const TRIAGE_CAPABILITY_MAP: Record<string, string[]> = {
  STEMI: ["PCI"],
  Stroke: ["STROKE", "NEURO", "CT"],
  Trauma: ["TRAUMA"],
  Burns: ["BURNS"],
  Pediatric: ["PEDIATRIC"],
  General: [], // Any hospital
};

// ============ Service ============

class DestinationService {
  /**
   * Find the best hospital for an incident
   *
   * @param incidentLat - Incident latitude
   * @param incidentLng - Incident longitude
   * @param severity - HIGH or LOW severity
   * @param requiredType - Required ambulance type (optional)
   * @param triageType - Triage classification (optional)
   * @returns Best hospital based on criteria
   */
  async findBestHospital(
    incidentLat: number,
    incidentLng: number,
    severity: Severity,
    requiredType?: AmbulanceType | string,
    triageType?: string
  ): Promise<HospitalResult | null> {
    // Fetch all hospitals
    const hospitals = await prisma.hospital.findMany();

    if (hospitals.length === 0) {
      console.warn("⚠️ No hospitals found in database");
      return null;
    }

    const incidentLocation: Coordinates = {
      lat: incidentLat,
      lng: incidentLng,
    };

    // Determine required capabilities based on severity, type, and triage
    const requiredCapabilities = this.getRequiredCapabilities(
      severity,
      requiredType,
      triageType
    );

    console.log(
      `🏥 Finding hospital for incident at ${incidentLat}, ${incidentLng}`
    );
    console.log(
      `   Severity: ${severity}, Type: ${requiredType || "Any"}, Triage: ${
        triageType || "General"
      }`
    );
    console.log(
      `   Required capabilities: ${
        requiredCapabilities.length > 0
          ? requiredCapabilities.join(", ")
          : "Any"
      }`
    );

    // Filter hospitals by capabilities
    let validHospitals = hospitals;

    if (requiredCapabilities.length > 0) {
      validHospitals = hospitals.filter((hospital) =>
        this.hasRequiredCapabilities(
          hospital.capabilities,
          requiredCapabilities
        )
      );

      console.log(
        `   Filtered to ${validHospitals.length} hospitals with required capabilities`
      );

      // If no specialized hospitals found, fall back to all hospitals
      if (validHospitals.length === 0) {
        console.log(
          "   ⚠️ No specialized hospitals found, using all hospitals"
        );
        validHospitals = hospitals;
      }
    }

    // Calculate distance and ETA for each hospital
    const hospitalResults: HospitalResult[] = validHospitals.map((hospital) => {
      const hospitalLocation: Coordinates = {
        lat: hospital.lat,
        lng: hospital.lng,
      };
      const route = routingService.calculateMockRoute(
        incidentLocation,
        hospitalLocation
      );

      return {
        id: hospital.id,
        name: hospital.name,
        lat: hospital.lat,
        lng: hospital.lng,
        capabilities: hospital.capabilities,
        distanceMeters: route.distanceMeters,
        etaSeconds: route.etaSeconds,
      };
    });

    // Sort by distance (ascending)
    hospitalResults.sort((a, b) => a.distanceMeters - b.distanceMeters);

    const best = hospitalResults[0];
    if (!best) {
      console.log("   ⚠️ No suitable hospital found");
      return null;
    }

    console.log(
      `   ✅ Best hospital: ${best.name} (${best.distanceMeters}m, ${best.etaSeconds}s ETA)`
    );

    return best;
  }

  /**
   * Get top N hospitals ranked by distance
   */
  async getTopHospitals(
    incidentLat: number,
    incidentLng: number,
    severity: Severity,
    requiredType?: AmbulanceType | string,
    triageType?: string,
    limit: number = 3
  ): Promise<HospitalResult[]> {
    const hospitals = await prisma.hospital.findMany();
    const incidentLocation: Coordinates = {
      lat: incidentLat,
      lng: incidentLng,
    };

    const requiredCapabilities = this.getRequiredCapabilities(
      severity,
      requiredType,
      triageType
    );

    let validHospitals = hospitals;

    if (requiredCapabilities.length > 0) {
      const filtered = hospitals.filter((hospital) =>
        this.hasRequiredCapabilities(
          hospital.capabilities,
          requiredCapabilities
        )
      );
      if (filtered.length > 0) {
        validHospitals = filtered;
      }
    }

    const hospitalResults: HospitalResult[] = validHospitals.map((hospital) => {
      const hospitalLocation: Coordinates = {
        lat: hospital.lat,
        lng: hospital.lng,
      };
      const route = routingService.calculateMockRoute(
        incidentLocation,
        hospitalLocation
      );

      return {
        id: hospital.id,
        name: hospital.name,
        lat: hospital.lat,
        lng: hospital.lng,
        capabilities: hospital.capabilities,
        distanceMeters: route.distanceMeters,
        etaSeconds: route.etaSeconds,
      };
    });

    hospitalResults.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return hospitalResults.slice(0, limit);
  }

  /**
   * Determine required capabilities based on severity, ambulance type, and triage
   */
  private getRequiredCapabilities(
    severity: Severity,
    requiredType?: AmbulanceType | string,
    triageType?: string
  ): string[] {
    const capabilities: Set<string> = new Set();

    // High severity needs specialized hospitals
    if (severity === "HIGH") {
      // Add triage-based capabilities
      if (triageType && TRIAGE_CAPABILITY_MAP[triageType]) {
        TRIAGE_CAPABILITY_MAP[triageType].forEach((cap) =>
          capabilities.add(cap)
        );
      }
    }

    // ALS/CCT ambulance types need specialized hospitals
    if (requiredType && ["ALS", "CCT"].includes(requiredType)) {
      const typeCaps = AMBULANCE_TYPE_CAPABILITY_MAP[requiredType] || [];
      typeCaps.forEach((cap) => capabilities.add(cap));
    }

    return Array.from(capabilities);
  }

  /**
   * Check if hospital has at least one of the required capabilities
   */
  private hasRequiredCapabilities(
    hospitalCapabilities: string[],
    requiredCapabilities: string[]
  ): boolean {
    if (requiredCapabilities.length === 0) return true;

    // Hospital must have at least one of the required capabilities
    const hospitalCapsUpper = hospitalCapabilities.map((c) => c.toUpperCase());
    return requiredCapabilities.some((req) =>
      hospitalCapsUpper.includes(req.toUpperCase())
    );
  }
}

// Export singleton instance
export const destinationService = new DestinationService();
