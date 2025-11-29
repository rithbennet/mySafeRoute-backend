import type { Location, RouteResult } from "../../shared/types";

/**
 * Routing Provider Interface
 * Abstraction for different routing services
 */
export interface IRoutingProvider {
  getRoute(from: Location, to: Location): Promise<RouteResult>;
}

/**
 * OpenRouteService Adapter
 * Implements routing using OpenRouteService API
 */
export class OpenRouteServiceAdapter implements IRoutingProvider {
  private apiKey: string;
  private baseUrl =
    "https://api.openrouteservice.org/v2/directions/driving-car";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getRoute(from: Location, to: Location): Promise<RouteResult> {
    // If no API key, use fallback estimation
    if (!this.apiKey || this.apiKey === "your_openrouteservice_api_key_here") {
      return this.getFallbackRoute(from, to);
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
          format: "geojson",
        }),
      });

      if (!response.ok) {
        console.warn(`ORS API error: ${response.status}, using fallback`);
        return this.getFallbackRoute(from, to);
      }

      const data = (await response.json()) as {
        features: Array<{
          geometry: any;
          properties: { summary: { duration: number; distance: number } };
        }>;
      };
      const route = data.features[0];

      if (!route) {
        return this.getFallbackRoute(from, to);
      }

      return {
        geometry: route.geometry,
        etaSeconds: route.properties.summary.duration,
        distanceMeters: route.properties.summary.distance,
      };
    } catch (error) {
      console.warn("ORS API failed, using fallback:", error);
      return this.getFallbackRoute(from, to);
    }
  }

  /**
   * Fallback route estimation when API is unavailable
   * Uses straight-line distance with traffic multiplier
   */
  private getFallbackRoute(from: Location, to: Location): RouteResult {
    // Calculate straight-line distance
    const distanceMeters = this.haversineDistance(
      from.lat,
      from.lng,
      to.lat,
      to.lng
    );

    // Estimate real road distance (typically 1.3x straight line in urban areas)
    const roadDistance = distanceMeters * 1.3;

    // Assume average speed of 40 km/h in urban KL traffic
    const avgSpeedMs = (40 * 1000) / 3600; // meters per second
    const etaSeconds = Math.round(roadDistance / avgSpeedMs);

    // Generate simple line geometry
    const geometry = {
      type: "LineString",
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    };

    return {
      geometry,
      etaSeconds,
      distanceMeters: Math.round(roadDistance),
    };
  }

  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371000;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

// Singleton instance
let routingProvider: IRoutingProvider | null = null;

export function getRoutingProvider(): IRoutingProvider {
  if (!routingProvider) {
    const apiKey = process.env.ORS_API_KEY || "";
    routingProvider = new OpenRouteServiceAdapter(apiKey);
  }
  return routingProvider;
}
