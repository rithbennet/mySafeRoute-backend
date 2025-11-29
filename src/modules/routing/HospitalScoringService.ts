import { prisma } from "../../shared/store/prisma";
import type { Hospital as PrismaHospital } from "../../shared/store/prisma";
import type {
  Location,
  Hospital,
  HospitalScore,
  TriageType,
} from "../../shared/types";
import { getRoutingProvider } from "./RoutingAdapter";
import { hazardService } from "./HazardService";
import { getRequiredCapabilities } from "../../shared/utils";

/**
 * Convert Prisma Hospital to API Hospital format
 */
function toApiHospital(h: PrismaHospital): Hospital {
  return {
    id: String(h.id),
    name: h.name,
    location: { lat: h.lat, lng: h.lng },
    capabilities: h.capabilities as Hospital["capabilities"],
    status: "OPEN", // Default status since not in DB yet
    load: 50, // Default load since not in DB yet
  };
}

/**
 * Hospital Scoring Service
 * Calculates and ranks hospitals based on capability, status, load, and ETA
 */
export class HospitalScoringService {
  /**
   * Calculate score for a hospital given an incident
   *
   * Scoring Logic:
   * 1. Capability Check - If hospital lacks required capability -> Score 0
   * 2. Status Check - If hospital is diverting/closed -> Score 0
   * 3. Efficiency Score = (1 - normalized_load) * load_weight + (1 - normalized_eta) * eta_weight
   */
  async calculateScore(
    incidentLocation: Location,
    incidentTriage: TriageType,
    hospital: Hospital
  ): Promise<HospitalScore> {
    // Check capability
    const requiredCapabilities = getRequiredCapabilities(incidentTriage);
    const hasCapability = requiredCapabilities.some((cap) =>
      hospital.capabilities.includes(cap as any)
    );

    if (!hasCapability) {
      return {
        hospital,
        score: 0,
        etaSeconds: Infinity,
        distanceMeters: Infinity,
        route: null,
      };
    }

    // Check status
    if (hospital.status !== "OPEN") {
      return {
        hospital,
        score: 0,
        etaSeconds: Infinity,
        distanceMeters: Infinity,
        route: null,
      };
    }

    // Get route to hospital
    const routingProvider = getRoutingProvider();
    const route = await routingProvider.getRoute(
      incidentLocation,
      hospital.location
    );

    // Apply hazard penalties
    const routeWithPenalties = hazardService.applyHazardPenalties(route);

    // Calculate efficiency score
    // Higher score = better choice
    // Weight: 40% load, 60% ETA
    const loadScore = 1 - hospital.load / 100;

    // Normalize ETA (assume max reasonable ETA is 60 mins = 3600 seconds)
    const maxETA = 3600;
    const normalizedETA = Math.min(routeWithPenalties.etaSeconds / maxETA, 1);
    const etaScore = 1 - normalizedETA;

    const score = loadScore * 0.4 + etaScore * 0.6;

    return {
      hospital,
      score: Math.round(score * 100) / 100,
      etaSeconds: routeWithPenalties.etaSeconds,
      distanceMeters: routeWithPenalties.distanceMeters,
      route: routeWithPenalties.geometry,
    };
  }

  /**
   * Get ranked list of hospitals for an incident
   * Now fetches from Prisma database
   */
  async rankHospitals(
    incidentLocation: Location,
    incidentTriage: TriageType,
    limit: number = 3
  ): Promise<HospitalScore[]> {
    // Fetch hospitals from database
    const prismaHospitals = await prisma.hospital.findMany();

    // Convert to API format
    const hospitals = prismaHospitals.map(toApiHospital);

    // Calculate scores for all hospitals in parallel
    const scores = await Promise.all(
      hospitals.map((hospital) =>
        this.calculateScore(incidentLocation, incidentTriage, hospital)
      )
    );

    // Filter out invalid hospitals and sort by score descending
    const validScores = scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return validScores.slice(0, limit);
  }

  /**
   * Get the best hospital for an incident
   */
  async getBestHospital(
    incidentLocation: Location,
    incidentTriage: TriageType
  ): Promise<HospitalScore | null> {
    const ranked = await this.rankHospitals(
      incidentLocation,
      incidentTriage,
      1
    );
    return ranked[0] || null;
  }
}

// Singleton instance
export const hospitalScoringService = new HospitalScoringService();
