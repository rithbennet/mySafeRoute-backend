import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getRoutingProvider, getTomTomProvider } from "./RoutingAdapter";
import { LocationSchema } from "../../shared/types";
import { hazardService } from "./HazardService";
import { getTrafficService } from "./TrafficService";
import db from "../../shared/store/Database";

/**
 * Route Request Schema
 */
const RouteRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  avoidHazards: z.boolean().optional().default(true),
});

/**
 * Optimal Route Request Schema
 */
const OptimalRouteRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  avoidHazards: z.boolean().optional().default(true),
  avoidTraffic: z.boolean().optional().default(true),
});

/**
 * Routing Routes - Direct API to test routing between two points
 */
export async function routingRoutes(fastify: FastifyInstance) {
  /**
   * GET /routes/api-key
   * Get the Google Maps API key for frontend use
   */
  fastify.get(
    "/routes/api-key",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = process.env.GOOGLE_API_KEY;
      
      if (!apiKey) {
        return reply.status(500).send({
          success: false,
          error: "Google API key not configured",
        });
      }

      return reply.send({
        success: true,
        apiKey: apiKey,
      });
    }
  );

  /**
   * GET /routes/traffic
   * Get traffic data and hazards for map display
   * Returns hazard zones that can be displayed on Google Maps
   */
  fastify.get(
    "/routes/traffic",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const activeHazards = db.getActiveHazards();
        
        // Format hazards for Google Maps display
        const hazards = activeHazards.map((hazard) => {
          const color = getHazardColor(hazard.type);
          return {
            id: hazard.id,
            type: hazard.type,
            description: hazard.description,
            severity: getHazardSeverity(hazard.type),
            color: color,
            bounds: hazard.bounds,
            // Google Maps Rectangle bounds format
            rectangle: {
              north: hazard.bounds.maxLat,
              south: hazard.bounds.minLat,
              east: hazard.bounds.maxLng,
              west: hazard.bounds.minLng,
            },
            // Center point for marker
            center: {
              lat: (hazard.bounds.minLat + hazard.bounds.maxLat) / 2,
              lng: (hazard.bounds.minLng + hazard.bounds.maxLng) / 2,
            },
            active: hazard.active,
            createdAt: hazard.createdAt,
          };
        });

        return reply.send({
          success: true,
          data: {
            hazards,
            count: hazards.length,
            // Traffic layer is provided by Google Maps JavaScript API
            // Just need to enable TrafficLayer on the map
            trafficLayerEnabled: true,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("Error fetching traffic data:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to fetch traffic data",
        });
      }
    }
  );

  /**
   * POST /routes/calculate
   * Calculate route between two points using Google Routes API
   * Includes hazard detection and avoidance
   * 
   * Body:
   * {
   *   "origin": { "lat": 3.1390, "lng": 101.6869 },
   *   "destination": { "lat": 3.1714, "lng": 101.7006 },
   *   "avoidHazards": true
   * }
   */
  fastify.post(
    "/routes/calculate",
    async (
      request: FastifyRequest<{
        Body: {
          origin: { lat: number; lng: number };
          destination: { lat: number; lng: number };
          avoidHazards?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = RouteRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
          example: {
            origin: { lat: 3.1390, lng: 101.6869 },
            destination: { lat: 3.1714, lng: 101.7006 },
            avoidHazards: true,
          },
        });
      }

      const { origin, destination, avoidHazards } = parseResult.data;

      try {
        const routingProvider = getRoutingProvider("google");
        const startTime = Date.now();
        
        const route = await routingProvider.getRoute(origin, destination);
        
        const responseTime = Date.now() - startTime;

        // Check for hazard intersections
        let hazardInfo = null;
        if (avoidHazards) {
          const hazardCheck = hazardService.checkRouteHazards(route);
          if (hazardCheck.intersectsHazard) {
            hazardInfo = {
              intersectsHazard: true,
              hazards: hazardCheck.hazards.map(h => ({
                id: h.id,
                type: h.type,
                description: h.description,
              })),
              penaltySeconds: hazardCheck.totalPenalty,
              adjustedEtaSeconds: route.etaSeconds + hazardCheck.totalPenalty,
            };
          }
        }

        return reply.send({
          success: true,
          data: {
            origin,
            destination,
            route: {
              geometry: route.geometry,
              etaSeconds: hazardInfo ? hazardInfo.adjustedEtaSeconds : route.etaSeconds,
              etaFormatted: formatDuration(hazardInfo ? hazardInfo.adjustedEtaSeconds : route.etaSeconds),
              distanceMeters: route.distanceMeters,
              distanceKm: (route.distanceMeters / 1000).toFixed(2),
            },
            hazards: hazardInfo,
            meta: {
              provider: "google",
              responseTimeMs: responseTime,
              avoidHazards,
            },
          },
        });
      } catch (error) {
        console.error("Route calculation error:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to calculate route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  /**
   * GET /routes/test
   * Quick test endpoint with hardcoded KL coordinates
   */
  fastify.get(
    "/routes/test",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const origin = { lat: 3.1390, lng: 101.6869 }; // KL City Center
      const destination = { lat: 3.1714, lng: 101.7006 }; // Hospital KL

      try {
        const routingProvider = getRoutingProvider("google");
        const startTime = Date.now();
        
        const route = await routingProvider.getRoute(origin, destination);
        
        const responseTime = Date.now() - startTime;

        return reply.send({
          success: true,
          message: "Google Routes API is working!",
          data: {
            origin: { ...origin, name: "KL City Center" },
            destination: { ...destination, name: "Hospital Kuala Lumpur" },
            route: {
              etaSeconds: route.etaSeconds,
              etaFormatted: formatDuration(route.etaSeconds),
              distanceMeters: route.distanceMeters,
              distanceKm: (route.distanceMeters / 1000).toFixed(2),
              coordinatesCount: route.geometry?.coordinates?.length || 0,
            },
            meta: {
              provider: "google",
              responseTimeMs: responseTime,
            },
          },
        });
      } catch (error) {
        console.error("Route test error:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to test route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  /**
   * GET /routes/traffic-flow
   * Get real-time traffic flow data for a specific location
   * Uses TomTom Traffic Flow API
   * 
   * Query params: lat, lng
   */
  fastify.get(
    "/routes/traffic-flow",
    async (
      request: FastifyRequest<{
        Querystring: { lat: string; lng: string };
      }>,
      reply: FastifyReply
    ) => {
      const { lat, lng } = request.query;

      if (!lat || !lng) {
        return reply.status(400).send({
          success: false,
          error: "Missing lat or lng query parameters",
          example: "/routes/traffic-flow?lat=3.1390&lng=101.6869",
        });
      }

      try {
        const trafficService = getTrafficService();
        const flowData = await trafficService.getTrafficFlow({
          lat: parseFloat(lat),
          lng: parseFloat(lng),
        });

        if (!flowData) {
          return reply.status(503).send({
            success: false,
            error: "Traffic data unavailable",
            message: "TomTom API key may not be configured or API is unreachable",
          });
        }

        return reply.send({
          success: true,
          data: {
            location: { lat: parseFloat(lat), lng: parseFloat(lng) },
            traffic: {
              currentSpeed: flowData.currentSpeed,
              freeFlowSpeed: flowData.freeFlowSpeed,
              speedRatio: (flowData.currentSpeed / flowData.freeFlowSpeed).toFixed(2),
              congestionLevel: flowData.congestionLevel,
              currentTravelTime: flowData.currentTravelTime,
              freeFlowTravelTime: flowData.freeFlowTravelTime,
              delay: flowData.currentTravelTime - flowData.freeFlowTravelTime,
              roadClosure: flowData.roadClosure,
              confidence: flowData.confidence,
            },
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("Traffic flow error:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to fetch traffic flow data",
        });
      }
    }
  );

  /**
   * GET /routes/traffic-incidents
   * Get real-time traffic incidents in a bounding box
   * Uses TomTom Traffic Incidents API
   * 
   * Query params: minLat, maxLat, minLng, maxLng
   */
  fastify.get(
    "/routes/traffic-incidents",
    async (
      request: FastifyRequest<{
        Querystring: {
          minLat: string;
          maxLat: string;
          minLng: string;
          maxLng: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { minLat, maxLat, minLng, maxLng } = request.query;

      // Default to Klang Valley area if no bounds provided
      const bounds = {
        minLat: parseFloat(minLat) || 2.9,
        maxLat: parseFloat(maxLat) || 3.3,
        minLng: parseFloat(minLng) || 101.4,
        maxLng: parseFloat(maxLng) || 101.9,
      };

      try {
        const trafficService = getTrafficService();
        const incidents = await trafficService.getTrafficIncidents(bounds);

        return reply.send({
          success: true,
          data: {
            bounds,
            incidents: incidents.map((inc) => ({
              id: inc.id,
              type: inc.type,
              severity: inc.severity,
              severityLabel: getSeverityLabel(inc.severity),
              description: inc.description,
              location: inc.location,
              delay: inc.delay,
              delayFormatted: formatDuration(inc.delay),
              roadName: inc.roadName,
              startTime: inc.startTime,
              endTime: inc.endTime,
            })),
            count: incidents.length,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("Traffic incidents error:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to fetch traffic incidents",
        });
      }
    }
  );

  /**
   * POST /routes/optimal
   * Calculate the optimal route avoiding traffic congestion and hazards
   * Uses TomTom Routing API with real-time traffic
   * 
   * Body:
   * {
   *   "origin": { "lat": 3.1390, "lng": 101.6869 },
   *   "destination": { "lat": 3.1714, "lng": 101.7006 },
   *   "avoidHazards": true,
   *   "avoidTraffic": true
   * }
   */
  fastify.post(
    "/routes/optimal",
    async (
      request: FastifyRequest<{
        Body: {
          origin: { lat: number; lng: number };
          destination: { lat: number; lng: number };
          avoidHazards?: boolean;
          avoidTraffic?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = OptimalRouteRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
          example: {
            origin: { lat: 3.1390, lng: 101.6869 },
            destination: { lat: 3.1714, lng: 101.7006 },
            avoidHazards: true,
            avoidTraffic: true,
          },
        });
      }

      const { origin, destination, avoidHazards, avoidTraffic } = parseResult.data;

      try {
        const startTime = Date.now();
        const tomtomProvider = getTomTomProvider();
        const trafficService = getTrafficService();

        // Get hazards to avoid
        const hazardsToAvoid = avoidHazards ? db.getActiveHazards() : [];

        // Get the optimal route with hazard avoidance (TomTom handles traffic automatically)
        const routeResult = await tomtomProvider.getRouteAvoidingHazards(
          origin,
          destination,
          hazardsToAvoid
        );

        const responseTime = Date.now() - startTime;

        // Get traffic conditions along the route
        let trafficConditions = null;
        if (routeResult.geometry?.coordinates?.length > 0) {
          // Sample a few points along the route to check traffic
          const coords = routeResult.geometry.coordinates as [number, number][];
          const midIndex = Math.floor(coords.length / 2);
          const samplePoints = [
            coords[0],
            coords[midIndex],
            coords[coords.length - 1],
          ].filter((p): p is [number, number] => p !== undefined);

          const trafficFlows = await Promise.all(
            samplePoints.map((coord) =>
              trafficService.getTrafficFlow({ lat: coord[1], lng: coord[0] })
            )
          );

          const validFlows = trafficFlows.filter((f) => f !== null);
          if (validFlows.length > 0) {
            const avgSpeed = validFlows.reduce((sum, f) => sum + f!.currentSpeed, 0) / validFlows.length;
            const avgFreeFlow = validFlows.reduce((sum, f) => sum + f!.freeFlowSpeed, 0) / validFlows.length;
            const worstCongestion = validFlows.reduce(
              (worst, f) => {
                const levels = ["free", "light", "moderate", "heavy", "severe"];
                return levels.indexOf(f!.congestionLevel) > levels.indexOf(worst)
                  ? f!.congestionLevel
                  : worst;
              },
              "free" as "free" | "light" | "moderate" | "heavy" | "severe"
            );

            trafficConditions = {
              averageSpeed: Math.round(avgSpeed),
              averageFreeFlowSpeed: Math.round(avgFreeFlow),
              speedRatio: (avgSpeed / avgFreeFlow).toFixed(2),
              overallCongestion: worstCongestion,
              sampledPoints: validFlows.length,
            };
          }
        }

        // Get traffic incidents near the route
        const bounds = calculateRouteBounds(routeResult.geometry?.coordinates || []);
        const incidents = await trafficService.getTrafficIncidents(bounds);

        // Filter incidents that might affect this route
        const relevantIncidents = incidents.slice(0, 5).map((inc) => ({
          type: inc.type,
          severity: getSeverityLabel(inc.severity),
          description: inc.description,
          delay: formatDuration(inc.delay),
          location: inc.location,
        }));

        return reply.send({
          success: true,
          data: {
            origin,
            destination,
            route: {
              geometry: routeResult.geometry,
              etaSeconds: routeResult.etaSeconds,
              etaFormatted: formatDuration(routeResult.etaSeconds),
              distanceMeters: routeResult.distanceMeters,
              distanceKm: (routeResult.distanceMeters / 1000).toFixed(2),
              coordinatesCount: routeResult.geometry?.coordinates?.length || 0,
            },
            traffic: trafficConditions,
            hazards: {
              avoided: routeResult.avoidedHazards?.length || 0,
              list: routeResult.avoidedHazards?.map((h) => ({
                id: h.id,
                type: h.type,
                description: h.description,
              })) || [],
            },
            nearbyIncidents: relevantIncidents,
            meta: {
              provider: "tomtom",
              responseTimeMs: responseTime,
              avoidHazards,
              avoidTraffic,
              routeType: "fastest",
              trafficAware: true,
            },
          },
        });
      } catch (error) {
        console.error("Optimal route calculation error:", error);
        return reply.status(500).send({
          success: false,
          error: "Failed to calculate optimal route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
}

/**
 * Format seconds into human-readable duration
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Get color for hazard type (for map display)
 */
function getHazardColor(type: string): string {
  const colors: Record<string, string> = {
    FLOOD: "#1E90FF",      // Blue
    ACCIDENT: "#FF4444",   // Red
    ROADBLOCK: "#FF8C00",  // Orange
    CONSTRUCTION: "#FFD700", // Yellow/Gold
    OTHER: "#808080",      // Gray
  };
  return colors[type] ?? "#808080";
}

/**
 * Get severity level for hazard type
 */
function getHazardSeverity(type: string): string {
  const severity: Record<string, string> = {
    FLOOD: "high",
    ACCIDENT: "high",
    ROADBLOCK: "medium",
    CONSTRUCTION: "low",
    OTHER: "low",
  };
  return severity[type] ?? "low";
}

/**
 * Get severity label from TomTom severity number
 */
function getSeverityLabel(severity: number): string {
  const labels: Record<number, string> = {
    1: "Minor",
    2: "Moderate",
    3: "Major",
    4: "Severe",
  };
  return labels[severity] ?? "Unknown";
}

/**
 * Calculate bounding box from route coordinates
 */
function calculateRouteBounds(coordinates: number[][] | unknown): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const coords = coordinates as [number, number][];
  
  if (!coords || coords.length === 0) {
    // Default to Klang Valley area
    return {
      minLat: 2.9,
      maxLat: 3.3,
      minLng: 101.4,
      maxLng: 101.9,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const coord of coords) {
    const [lng, lat] = coord;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // Add a small buffer around the route
  const latBuffer = (maxLat - minLat) * 0.1 || 0.01;
  const lngBuffer = (maxLng - minLng) * 0.1 || 0.01;

  return {
    minLat: minLat - latBuffer,
    maxLat: maxLat + latBuffer,
    minLng: minLng - lngBuffer,
    maxLng: maxLng + lngBuffer,
  };
}
