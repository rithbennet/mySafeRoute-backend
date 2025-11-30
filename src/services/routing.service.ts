/**
 * Mock Routing Service
 *
 * Provides distance and ETA calculations using Haversine formula
 * Returns mock GeoJSON routes for map visualization
 */

import { haversineDistance } from "../shared/utils";

// ============ Types ============

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteResult {
  /** GeoJSON LineString geometry */
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat] pairs (GeoJSON format)
  };
  /** Distance in meters */
  distanceMeters: number;
  /** Estimated time of arrival in seconds */
  etaSeconds: number;
}

// ============ Constants ============

/** Tortuosity factor - roads are not straight lines */
const TORTUOSITY_FACTOR = 1.4;

/** Average ambulance speed in km/h */
const AVERAGE_SPEED_KMH = 50;

/** Convert km/h to m/s */
const AVERAGE_SPEED_MS = AVERAGE_SPEED_KMH / 3.6;

// ============ Service ============

class RoutingService {
  /**
   * Calculate a mock route between two points
   *
   * @param start - Starting coordinates (e.g., ambulance location)
   * @param end - Ending coordinates (e.g., incident or hospital location)
   * @returns Route result with geometry, distance, and ETA
   */
  calculateMockRoute(start: Coordinates, end: Coordinates): RouteResult {
    // Calculate straight-line distance using Haversine
    const straightLineDistance = haversineDistance(
      start.lat,
      start.lng,
      end.lat,
      end.lng
    );

    // Apply tortuosity factor for realistic road distance
    const roadDistance = straightLineDistance * TORTUOSITY_FACTOR;

    // Calculate ETA: distance (m) / speed (m/s) = time (s)
    const etaSeconds = Math.round(roadDistance / AVERAGE_SPEED_MS);

    // Generate simple GeoJSON LineString
    // Note: GeoJSON uses [longitude, latitude] order
    const geometry = this.generateLineString(start, end);

    return {
      geometry,
      distanceMeters: Math.round(roadDistance),
      etaSeconds,
    };
  }

  /**
   * Calculate ETA only (faster for ranking)
   */
  calculateETA(start: Coordinates, end: Coordinates): number {
    const straightLineDistance = haversineDistance(
      start.lat,
      start.lng,
      end.lat,
      end.lng
    );
    const roadDistance = straightLineDistance * TORTUOSITY_FACTOR;
    return Math.round(roadDistance / AVERAGE_SPEED_MS);
  }

  /**
   * Calculate distance only
   */
  calculateDistance(start: Coordinates, end: Coordinates): number {
    const straightLineDistance = haversineDistance(
      start.lat,
      start.lng,
      end.lat,
      end.lng
    );
    return Math.round(straightLineDistance * TORTUOSITY_FACTOR);
  }

  /**
   * Generate a simple GeoJSON LineString between two points
   * For MVP, this is just a straight line. Could add intermediate points later.
   */
  private generateLineString(
    start: Coordinates,
    end: Coordinates
  ): RouteResult["geometry"] {
    return {
      type: "LineString",
      coordinates: [
        [start.lng, start.lat], // GeoJSON is [lng, lat]
        [end.lng, end.lat],
      ],
    };
  }

  /**
   * Generate a more detailed line with intermediate points
   * Useful for animation on the map
   */
  generateDetailedLineString(
    start: Coordinates,
    end: Coordinates,
    numPoints: number = 10
  ): RouteResult["geometry"] {
    const coordinates: [number, number][] = [];

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const lat = start.lat + (end.lat - start.lat) * t;
      const lng = start.lng + (end.lng - start.lng) * t;
      coordinates.push([lng, lat]);
    }

    return {
      type: "LineString",
      coordinates,
    };
  }

  /**
   * Interpolate position along a route at a given progress (0-1)
   */
  interpolatePosition(
    start: Coordinates,
    end: Coordinates,
    progress: number
  ): Coordinates {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return {
      lat: start.lat + (end.lat - start.lat) * clampedProgress,
      lng: start.lng + (end.lng - start.lng) * clampedProgress,
    };
  }
}

// Export singleton instance
export const routingService = new RoutingService();
