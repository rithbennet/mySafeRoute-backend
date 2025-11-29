import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getRoutingProvider } from "./RoutingAdapter";
import { LocationSchema } from "../../shared/types";

/**
 * Route Request Schema
 */
const RouteRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
});

/**
 * Routing Routes - Direct API to test routing between two points
 */
export async function routingRoutes(fastify: FastifyInstance) {
  /**
   * POST /routes/calculate
   * Calculate route between two points using Google Routes API
   * 
   * Body:
   * {
   *   "origin": { "lat": 3.1390, "lng": 101.6869 },
   *   "destination": { "lat": 3.1714, "lng": 101.7006 }
   * }
   */
  fastify.post(
    "/routes/calculate",
    async (
      request: FastifyRequest<{
        Body: {
          origin: { lat: number; lng: number };
          destination: { lat: number; lng: number };
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
          },
        });
      }

      const { origin, destination } = parseResult.data;

      try {
        const routingProvider = getRoutingProvider("google");
        const startTime = Date.now();
        
        const route = await routingProvider.getRoute(origin, destination);
        
        const responseTime = Date.now() - startTime;

        return reply.send({
          success: true,
          data: {
            origin,
            destination,
            route: {
              geometry: route.geometry,
              etaSeconds: route.etaSeconds,
              etaFormatted: formatDuration(route.etaSeconds),
              distanceMeters: route.distanceMeters,
              distanceKm: (route.distanceMeters / 1000).toFixed(2),
            },
            meta: {
              provider: "google",
              responseTimeMs: responseTime,
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
