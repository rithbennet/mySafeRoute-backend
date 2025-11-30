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

  /**
   * Get position along a polyline at a given progress (0-1)
   * Walks along the actual route coordinates for realistic movement
   *
   * @param coordinates - Array of [lng, lat] pairs (GeoJSON format)
   * @param progress - Progress from 0 to 1
   * @returns Coordinates at the given progress point
   */
  getPositionAlongPolyline(
    coordinates: [number, number][],
    progress: number
  ): Coordinates {
    const clampedProgress = Math.max(0, Math.min(1, progress));

    if (coordinates.length === 0) {
      throw new Error("Cannot interpolate along empty polyline");
    }

    const firstCoord = coordinates[0]!;
    const lastCoord = coordinates[coordinates.length - 1]!;

    if (coordinates.length === 1) {
      return { lng: firstCoord[0], lat: firstCoord[1] };
    }

    // Calculate cumulative distances for each segment
    const segmentDistances: number[] = [];
    let totalDistance = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1]!;
      const curr = coordinates[i]!;
      const distance = haversineDistance(prev[1], prev[0], curr[1], curr[0]);
      segmentDistances.push(distance);
      totalDistance += distance;
    }

    // Handle edge cases
    if (totalDistance === 0 || clampedProgress === 0) {
      return { lng: firstCoord[0], lat: firstCoord[1] };
    }

    if (clampedProgress >= 1) {
      return { lng: lastCoord[0], lat: lastCoord[1] };
    }

    // Find the target distance along the route
    const targetDistance = totalDistance * clampedProgress;

    // Walk along segments to find which segment contains our target
    let accumulatedDistance = 0;

    for (let i = 0; i < segmentDistances.length; i++) {
      const segmentLength = segmentDistances[i]!;

      if (accumulatedDistance + segmentLength >= targetDistance) {
        // Target is within this segment
        const distanceIntoSegment = targetDistance - accumulatedDistance;
        const segmentProgress =
          segmentLength > 0 ? distanceIntoSegment / segmentLength : 0;

        const start = coordinates[i]!;
        const end = coordinates[i + 1]!;

        // Linear interpolation within this segment
        return {
          lat: start[1] + (end[1] - start[1]) * segmentProgress,
          lng: start[0] + (end[0] - start[0]) * segmentProgress,
        };
      }

      accumulatedDistance += segmentLength;
    }

    // Fallback to last point (should not reach here)
    return { lng: lastCoord[0], lat: lastCoord[1] };
  }

  /**
   * Calculate total distance of a polyline in meters
   */
  calculatePolylineDistance(coordinates: [number, number][]): number {
    let totalDistance = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1]!;
      const curr = coordinates[i]!;
      totalDistance += haversineDistance(prev[1], prev[0], curr[1], curr[0]);
    }

    return totalDistance;
  }
}

// Export singleton instance
export const routingService = new RoutingService();
