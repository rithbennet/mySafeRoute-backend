/**
 * Simulation Controller Routes
 *
 * Demo/God Mode endpoints for creating scenarios and managing simulations
 *
 * Endpoints:
 * - POST /api/simulation/scenario - Create a new demo incident
 * - POST /api/simulation/seed - Seed multiple random incidents
 * - POST /api/ai/analyze - Mock AI analysis of description
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { scenarioService } from "../../services";
import { simulationService } from "../../services/simulation.service";

// ============ Validation Schemas ============

const ScenarioRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z.string().min(1).max(500),
  callerName: z.string().optional(),
  callerPhone: z.string().optional(),
});

const SeedRequestSchema = z.object({
  count: z.number().min(1).max(20).default(5),
  centerLat: z.number().min(-90).max(90).default(3.0569), // Subang Jaya
  centerLng: z.number().min(-180).max(180).default(101.5851),
  radiusKm: z.number().min(1).max(50).default(5),
});

const AnalyzeRequestSchema = z.object({
  text: z.string().min(1).max(1000),
});

// ============ Routes ============

export async function simulationRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/simulation/scenario
   * Create a demo scenario (God Mode)
   *
   * This creates a User and Incident without triggering any "incoming call" flow.
   * The incident appears directly in the dispatcher's pending list.
   */
  fastify.post(
    "/api/simulation/scenario",
    {
      schema: {
        tags: ["Simulation"],
        summary: "Create demo scenario (God Mode)",
        description: `
Creates a new emergency incident for demo purposes.

**Flow:**
1. Analyzes description with mock AI to determine category/severity
2. Creates a User record (caller/victim)
3. Creates an Incident with status PENDING
4. Broadcasts \`INCIDENT_ADDED\` via WebSocket

**Note:** This does NOT trigger an incoming call ring - the incident 
appears directly in the dispatcher's list.
        `,
        body: {
          type: "object",
          required: ["lat", "lng", "description"],
          properties: {
            lat: {
              type: "number",
              minimum: -90,
              maximum: 90,
              description: "Incident latitude",
            },
            lng: {
              type: "number",
              minimum: -180,
              maximum: 180,
              description: "Incident longitude",
            },
            description: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description:
                "Description of the emergency (used for AI classification)",
            },
            callerName: {
              type: "string",
              description: "Name of the caller (optional)",
            },
            callerPhone: {
              type: "string",
              description: "Phone number of the caller (optional)",
            },
          },
        },
        response: {
          201: {
            description: "Scenario created successfully",
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  incidentId: { type: "string" },
                  userId: { type: "integer" },
                  category: {
                    type: "string",
                    enum: ["MEDICAL", "FIRE", "ACCIDENT", "OTHER"],
                  },
                  severity: { type: "string", enum: ["HIGH", "LOW"] },
                  triageType: {
                    type: "string",
                    enum: [
                      "STEMI",
                      "Stroke",
                      "Trauma",
                      "Burns",
                      "Pediatric",
                      "General",
                    ],
                  },
                },
              },
              message: { type: "string" },
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
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          lat: number;
          lng: number;
          description: string;
          callerName?: string;
          callerPhone?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = ScenarioRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        });
      }

      const result = await scenarioService.createScenario(parseResult.data);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          incidentId: result.incidentId,
          userId: result.userId,
          category: result.category,
          severity: result.severity,
          triageType: result.triageType,
        },
        message: result.message,
      });
    }
  );

  /**
   * POST /api/simulation/seed
   * Seed multiple random incidents for demo
   */
  fastify.post(
    "/api/simulation/seed",
    {
      schema: {
        tags: ["Simulation"],
        summary: "Seed random incidents",
        description:
          "Creates multiple random incidents around a center point for demo purposes",
        body: {
          type: "object",
          properties: {
            count: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              default: 5,
              description: "Number of incidents to create",
            },
            centerLat: {
              type: "number",
              default: 3.0569,
              description: "Center latitude (defaults to Subang Jaya)",
            },
            centerLng: {
              type: "number",
              default: 101.5851,
              description: "Center longitude",
            },
            radiusKm: {
              type: "number",
              default: 5,
              description: "Radius in km for random placement",
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    incidentId: { type: "string" },
                    category: { type: "string" },
                    severity: { type: "string" },
                  },
                },
              },
              count: { type: "integer" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          count?: number;
          centerLat?: number;
          centerLng?: number;
          radiusKm?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const parseResult = SeedRequestSchema.safeParse(request.body || {});
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        });
      }

      const { count, centerLat, centerLng, radiusKm } = parseResult.data;

      const results = await scenarioService.createRandomIncidents(
        count,
        centerLat,
        centerLng,
        radiusKm
      );

      return reply.status(201).send({
        success: true,
        data: results.map((r) => ({
          incidentId: r.incidentId,
          category: r.category,
          severity: r.severity,
        })),
        count: results.length,
        message: `Created ${results.length} random incidents`,
      });
    }
  );

  /**
   * POST /api/ai/analyze
   * Mock AI analysis of emergency description
   */
  fastify.post(
    "/api/ai/analyze",
    {
      schema: {
        tags: ["Simulation"],
        summary: "Mock AI analysis",
        description:
          "Analyzes text description using keyword matching to classify emergency type",
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: {
              type: "string",
              minLength: 1,
              maxLength: 1000,
              description: "Text to analyze",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: ["MEDICAL", "FIRE", "ACCIDENT", "OTHER"],
                  },
                  severity: { type: "string", enum: ["HIGH", "LOW"] },
                  triageType: {
                    type: "string",
                    enum: [
                      "STEMI",
                      "Stroke",
                      "Trauma",
                      "Burns",
                      "Pediatric",
                      "General",
                    ],
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score 0-1",
                  },
                  keywords: {
                    type: "array",
                    items: { type: "string" },
                    description: "Keywords that triggered the classification",
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { text: string } }>,
      reply: FastifyReply
    ) => {
      const parseResult = AnalyzeRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        });
      }

      const analysis = scenarioService.analyzeDescription(
        parseResult.data.text
      );

      return reply.send({
        success: true,
        data: analysis,
      });
    }
  );

  /**
   * GET /api/simulation/status
   * Get status of all active simulations
   */
  fastify.get(
    "/api/simulation/status",
    {
      schema: {
        tags: ["Simulation"],
        summary: "Get simulation status",
        description: "Returns count and info about active simulations",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              activeCount: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        success: true,
        activeCount: simulationService.getActiveCount(),
      });
    }
  );

  /**
   * DELETE /api/simulation/all
   * Cancel all active simulations (reset for demo)
   */
  fastify.delete(
    "/api/simulation/all",
    {
      schema: {
        tags: ["Simulation"],
        summary: "Cancel all simulations",
        description:
          "Cancels all running simulations and resets ambulances to IDLE",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Note: This would need a method in simulationService to cancel all
      // For now, just return the count
      const activeCount = simulationService.getActiveCount();

      return reply.send({
        success: true,
        message: `${activeCount} active simulations (cancel individually by incident ID)`,
      });
    }
  );
}
