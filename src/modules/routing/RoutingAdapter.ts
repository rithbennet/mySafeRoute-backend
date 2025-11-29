import type { Location, RouteResult, Hazard } from "../../shared/types";
import db from "../../shared/store/Database";

/**
 * Routing Provider Interface
 * Abstraction for different routing services
 */
export interface IRoutingProvider {
  getRoute(from: Location, to: Location): Promise<RouteResult>;
}

/**
 * Extended Routing Provider with Hazard Avoidance
 */
export interface IHazardAwareRoutingProvider extends IRoutingProvider {
  getRouteAvoidingHazards(
    from: Location,
    to: Location,
    hazards: Hazard[]
  ): Promise<RouteResult & { avoidedHazards: Hazard[] }>;
}

/**
 * TomTom Routing API Adapter
 * Implements routing using TomTom Routing API with hazard avoidance
 */
export class TomTomRoutingAdapter implements IHazardAwareRoutingProvider {
  private apiKey: string;
  private baseUrl = "https://api.tomtom.com/routing/1/calculateRoute";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getRoute(from: Location, to: Location): Promise<RouteResult> {
    // Get active hazards from database
    const activeHazards = db.getActiveHazards();
    const result = await this.getRouteAvoidingHazards(from, to, activeHazards);
    return result;
  }

  async getRouteAvoidingHazards(
    from: Location,
    to: Location,
    hazards: Hazard[]
  ): Promise<RouteResult & { avoidedHazards: Hazard[] }> {
    if (!this.apiKey || this.apiKey === "your_tomtom_api_key_here") {
      return {
        ...this.getFallbackRoute(from, to),
        avoidedHazards: [],
      };
    }

    try {
      // Build the route URL
      const routeUrl = `${this.baseUrl}/${from.lat},${from.lng}:${to.lat},${to.lng}/json`;

      // Build query parameters
      const params = new URLSearchParams({
        key: this.apiKey,
        traffic: "true",
        travelMode: "car",
        routeType: "fastest",
        computeTravelTimeFor: "all",
      });

      // Add avoid areas for each hazard (TomTom uses rectangles)
      if (hazards.length > 0) {
        const avoidAreas = hazards
          .map((h) => {
            // TomTom format: topLeftLat,topLeftLon:bottomRightLat,bottomRightLon
            return `${h.bounds.maxLat},${h.bounds.minLng}:${h.bounds.minLat},${h.bounds.maxLng}`;
          })
          .join("|");

        params.append("avoid", `rectangles:${avoidAreas}`);
      }

      const response = await fetch(`${routeUrl}?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(
          `TomTom API error: ${response.status} - ${errorText}, using fallback`
        );
        return {
          ...this.getFallbackRoute(from, to),
          avoidedHazards: [],
        };
      }

      const data = (await response.json()) as TomTomRouteResponse;
      const route = data.routes?.[0];

      if (!route) {
        console.warn("No routes returned from TomTom API, using fallback");
        return {
          ...this.getFallbackRoute(from, to),
          avoidedHazards: [],
        };
      }

      // Extract the route geometry
      const geometry = this.extractGeometry(route);

      return {
        geometry,
        etaSeconds: route.summary.travelTimeInSeconds,
        distanceMeters: route.summary.lengthInMeters,
        avoidedHazards: hazards,
      };
    } catch (error) {
      console.warn("TomTom API failed, using fallback:", error);
      return {
        ...this.getFallbackRoute(from, to),
        avoidedHazards: [],
      };
    }
  }

  /**
   * Extract GeoJSON LineString geometry from TomTom route
   */
  private extractGeometry(route: TomTomRoute): {
    type: string;
    coordinates: number[][];
  } {
    const coordinates: number[][] = [];

    for (const leg of route.legs) {
      for (const point of leg.points) {
        coordinates.push([point.longitude, point.latitude]);
      }
    }

    return {
      type: "LineString",
      coordinates,
    };
  }

  /**
   * Fallback route estimation when API is unavailable
   */
  private getFallbackRoute(from: Location, to: Location): RouteResult {
    const distanceMeters = this.haversineDistance(
      from.lat,
      from.lng,
      to.lat,
      to.lng
    );

    const roadDistance = distanceMeters * 1.3;
    const avgSpeedMs = (40 * 1000) / 3600;
    const etaSeconds = Math.round(roadDistance / avgSpeedMs);

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

// TomTom API Response Types
interface TomTomRouteResponse {
  routes: TomTomRoute[];
}

interface TomTomRoute {
  summary: {
    lengthInMeters: number;
    travelTimeInSeconds: number;
    trafficDelayInSeconds: number;
    departureTime: string;
    arrivalTime: string;
  };
  legs: TomTomLeg[];
}

interface TomTomLeg {
  points: TomTomPoint[];
}

interface TomTomPoint {
  latitude: number;
  longitude: number;
}

/**
 * Google Routes API Adapter
 * Implements routing using Google Routes API
 */
export class GoogleRoutesAdapter implements IRoutingProvider {
  private apiKey: string;
  private baseUrl = "https://routes.googleapis.com/directions/v2:computeRoutes";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getRoute(from: Location, to: Location): Promise<RouteResult> {
    // If no API key, use fallback estimation
    if (!this.apiKey || this.apiKey === "your_google_api_key_here") {
      return this.getFallbackRoute(from, to);
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: from.lat, longitude: from.lng },
            },
          },
          destination: {
            location: {
              latLng: { latitude: to.lat, longitude: to.lng },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Google Routes API error: ${response.status} - ${errorText}, using fallback`);
        return this.getFallbackRoute(from, to);
      }

      const data = (await response.json()) as {
        routes: Array<{
          duration: string; // e.g., "1234s"
          distanceMeters: number;
          polyline: { encodedPolyline: string };
        }>;
      };

      const route = data.routes?.[0];

      if (!route) {
        console.warn("No routes returned from Google Routes API, using fallback");
        return this.getFallbackRoute(from, to);
      }

      // Parse duration string (e.g., "1234s" -> 1234)
      const etaSeconds = parseInt(route.duration.replace("s", ""), 10);

      // Decode the polyline to GeoJSON LineString
      const geometry = this.decodePolylineToGeoJSON(route.polyline.encodedPolyline);

      return {
        geometry,
        etaSeconds,
        distanceMeters: route.distanceMeters,
      };
    } catch (error) {
      console.warn("Google Routes API failed, using fallback:", error);
      return this.getFallbackRoute(from, to);
    }
  }

  /**
   * Decode Google's encoded polyline to GeoJSON LineString
   * Based on the Encoded Polyline Algorithm
   */
  private decodePolylineToGeoJSON(encoded: string): {
    type: string;
    coordinates: number[][];
  } {
    const coordinates: number[][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      // Decode latitude
      let shift = 0;
      let result = 0;
      let byte: number;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      // Decode longitude
      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      // Google uses 5 decimal places precision (1e5)
      coordinates.push([lng / 1e5, lat / 1e5]);
    }

    return {
      type: "LineString",
      coordinates,
    };
  }

  /**
   * Fallback route estimation when API is unavailable
   * Uses straight-line distance with traffic multiplier
   */
  private getFallbackRoute(from: Location, to: Location): RouteResult {
    const distanceMeters = this.haversineDistance(
      from.lat,
      from.lng,
      to.lat,
      to.lng
    );

    const roadDistance = distanceMeters * 1.3;
    const avgSpeedMs = (40 * 1000) / 3600;
    const etaSeconds = Math.round(roadDistance / avgSpeedMs);

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

export type RoutingProviderType = "google" | "openrouteservice" | "tomtom";

export function getRoutingProvider(
  provider: RoutingProviderType = "tomtom"
): IRoutingProvider {
  if (!routingProvider) {
    if (provider === "tomtom") {
      const apiKey = process.env.TOMTOM_API_KEY || "";
      routingProvider = new TomTomRoutingAdapter(apiKey);
      console.log("Using TomTom Routes API for routing (with hazard avoidance)");
    } else if (provider === "google") {
      const apiKey = process.env.GOOGLE_API_KEY || "";
      routingProvider = new GoogleRoutesAdapter(apiKey);
      console.log("Using Google Routes API for routing");
    } else {
      const apiKey = process.env.ORS_API_KEY || "";
      routingProvider = new OpenRouteServiceAdapter(apiKey);
      console.log("Using OpenRouteService API for routing");
    }
  }
  return routingProvider;
}

// Get TomTom provider specifically (for hazard-aware routing)
export function getTomTomProvider(): TomTomRoutingAdapter {
  const apiKey = process.env.TOMTOM_API_KEY || "";
  return new TomTomRoutingAdapter(apiKey);
}

// Reset provider (useful for switching providers or testing)
export function resetRoutingProvider(): void {
  routingProvider = null;
}
