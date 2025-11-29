import db from "../../shared/store/Database";
import type { Hazard, RouteResult } from "../../shared/types";
import { routeIntersectsBounds } from "../../shared/utils";

// Penalty time in seconds for routes that intersect hazards
const HAZARD_PENALTY_SECONDS = 600; // 10 minutes

/**
 * Hazard Service
 * Handles hazard detection and route penalty calculation
 */
export class HazardService {
  /**
   * Check if a route intersects with any active hazards
   */
  checkRouteHazards(route: RouteResult): {
    intersectsHazard: boolean;
    hazards: Hazard[];
    totalPenalty: number;
  } {
    const activeHazards = db.getActiveHazards();
    const intersectingHazards: Hazard[] = [];

    if (!route.geometry || !route.geometry.coordinates) {
      return { intersectsHazard: false, hazards: [], totalPenalty: 0 };
    }

    const coordinates = route.geometry.coordinates as [number, number][];

    for (const hazard of activeHazards) {
      if (routeIntersectsBounds(coordinates, hazard.bounds)) {
        intersectingHazards.push(hazard);
      }
    }

    const totalPenalty = intersectingHazards.length * HAZARD_PENALTY_SECONDS;

    return {
      intersectsHazard: intersectingHazards.length > 0,
      hazards: intersectingHazards,
      totalPenalty,
    };
  }

  /**
   * Apply hazard penalties to a route result
   */
  applyHazardPenalties(route: RouteResult): RouteResult & {
    hazardPenalty: number;
    intersectingHazards: Hazard[];
  } {
    const hazardCheck = this.checkRouteHazards(route);

    return {
      ...route,
      etaSeconds: route.etaSeconds + hazardCheck.totalPenalty,
      hazardPenalty: hazardCheck.totalPenalty,
      intersectingHazards: hazardCheck.hazards,
    };
  }

  /**
   * Check if a specific point is in a hazard zone
   */
  isPointInHazardZone(lat: number, lng: number): boolean {
    const activeHazards = db.getActiveHazards();

    for (const hazard of activeHazards) {
      if (
        lat >= hazard.bounds.minLat &&
        lat <= hazard.bounds.maxLat &&
        lng >= hazard.bounds.minLng &&
        lng <= hazard.bounds.maxLng
      ) {
        return true;
      }
    }

    return false;
  }
}

// Singleton instance
export const hazardService = new HazardService();
