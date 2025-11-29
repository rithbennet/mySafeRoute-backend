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
   */
  fastify.post(
    "/routes/calculate",
    {
      schema: {
        tags: ["Routing"],
        summary: "Calculate route between two points",
        description: `
Calculate the optimal driving route between an origin and destination using Google Routes API.

Returns:
- **geometry**: GeoJSON LineString with route coordinates for map rendering
- **etaSeconds**: Estimated time of arrival in seconds
- **distanceMeters**: Total route distance in meters

Use this endpoint to get route polylines for displaying on maps.
        `,
        body: {
          type: "object",
          required: ["origin", "destination"],
          properties: {
            origin: {
              type: "object",
              required: ["lat", "lng"],
              properties: {
                lat: {
                  type: "number",
                  minimum: -90,
                  maximum: 90,
                  description: "Origin latitude",
                },
                lng: {
                  type: "number",
                  minimum: -180,
                  maximum: 180,
                  description: "Origin longitude",
                },
              },
            },
            destination: {
              type: "object",
              required: ["lat", "lng"],
              properties: {
                lat: {
                  type: "number",
                  minimum: -90,
                  maximum: 90,
                  description: "Destination latitude",
                },
                lng: {
                  type: "number",
                  minimum: -180,
                  maximum: 180,
                  description: "Destination longitude",
                },
              },
            },
          },
        },
        response: {
          200: {
            description: "Route calculated successfully",
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  origin: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  destination: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  route: {
                    type: "object",
                    properties: {
                      geometry: {
                        type: "object",
                        description: "GeoJSON LineString for map rendering",
                        properties: {
                          type: { type: "string" },
                          coordinates: {
                            type: "array",
                            items: {
                              type: "array",
                              items: { type: "number" },
                            },
                          },
                        },
                      },
                      etaSeconds: {
                        type: "integer",
                        description: "ETA in seconds",
                      },
                      etaFormatted: {
                        type: "string",
                        description: "Human-readable ETA",
                      },
                      distanceMeters: {
                        type: "integer",
                        description: "Distance in meters",
                      },
                      distanceKm: {
                        type: "string",
                        description: "Distance in kilometers",
                      },
                    },
                  },
                  meta: {
                    type: "object",
                    properties: {
                      provider: { type: "string" },
                      responseTimeMs: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              details: { type: "object" },
            },
          },
          500: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
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
            origin: { lat: 3.139, lng: 101.6869 },
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
   * Quick test endpoint with hardcoded KL coordinates - returns FULL route geometry
   */
  fastify.get(
    "/routes/test",
    {
      schema: {
        tags: ["Routing"],
        summary: "Test Google Routes API with full geometry",
        description:
          "Quick test endpoint with hardcoded Subang Jaya coordinates. Returns full route geometry for map rendering.",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              data: {
                type: "object",
                properties: {
                  origin: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                      name: { type: "string" },
                    },
                  },
                  destination: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                      name: { type: "string" },
                    },
                  },
                  route: {
                    type: "object",
                    properties: {
                      geometry: {
                        type: "object",
                        description:
                          "GeoJSON LineString - use coordinates for map polyline",
                        properties: {
                          type: { type: "string" },
                          coordinates: {
                            type: "array",
                            items: {
                              type: "array",
                              items: { type: "number" },
                            },
                          },
                        },
                      },
                      etaSeconds: { type: "integer" },
                      etaFormatted: { type: "string" },
                      distanceMeters: { type: "integer" },
                      distanceKm: { type: "string" },
                      coordinatesCount: { type: "integer" },
                    },
                  },
                  meta: {
                    type: "object",
                    properties: {
                      provider: { type: "string" },
                      responseTimeMs: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
          500: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Subang Jaya test coordinates
      const origin = { lat: 3.0733, lng: 101.6067 }; // Sunway Pyramid
      const destination = { lat: 3.0569, lng: 101.5851 }; // SJMC Hospital

      try {
        const routingProvider = getRoutingProvider("google");
        const startTime = Date.now();

        const route = await routingProvider.getRoute(origin, destination);

        const responseTime = Date.now() - startTime;

        return reply.send({
          success: true,
          message:
            "Google Routes API is working! Use geometry.coordinates for map polyline.",
          data: {
            origin: { ...origin, name: "Sunway Pyramid" },
            destination: { ...destination, name: "SJMC Hospital" },
            route: {
              geometry: route.geometry, // Full GeoJSON LineString for map rendering
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
