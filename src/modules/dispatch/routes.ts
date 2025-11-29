/**
 * Dispatch Routes
 *
 * REST API endpoints for auto-dispatch functionality
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { dispatchService } from "../../services";
import { simulationService } from "../../services/simulation.service";
import { AmbulanceType } from "../../shared/store/prisma";

// ============ Validation Schemas ============

const DispatchRequestSchema = z.object({
  incidentId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  requiredType: z.enum(["RRV", "BLS", "ALS", "CCT"]).optional(),
  severity: z.enum(["HIGH", "LOW"]).optional().default("LOW"),
  triageType: z
    .enum(["STEMI", "Stroke", "Trauma", "Burns", "Pediatric", "General"])
    .optional(),
});

const CandidatesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  requiredType: z.enum(["RRV", "BLS", "ALS", "CCT"]).optional(),
});

// ============ Routes ============

export async function dispatchRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/dispatch
   * Auto-dispatch an ambulance to an incident
   */
  fastify.post(
    "/api/dispatch",
    {
      schema: {
        tags: ["Dispatch"],
        summary: "Auto-dispatch ambulance to incident",
        description: `
Automatically dispatches the best available ambulance to an incident location.

**Algorithm:**
1. Fetches all IDLE ambulances
2. Filters by capability hierarchy (RRV < BLS < ALS < CCT)
3. Calculates ETA for each candidate
4. Assigns the closest capable ambulance
5. Triggers real-time simulation

**Simulation Phases:**
- **OUTBOUND**: Ambulance moves to incident (~10s)
- **ON_SCENE**: Pause at incident (~3s)
- **DECISION**: Selects best hospital
- **INBOUND**: Transports to hospital (~10s)
- **COMPLETE**: Ambulance parks at hospital

All updates are broadcast via WebSocket at \`/ws/dispatch\`.
        `,
        body: {
          type: "object",
          required: ["incidentId", "lat", "lng"],
          properties: {
            incidentId: {
              type: "string",
              description: "Unique incident identifier",
            },
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
            requiredType: {
              type: "string",
              enum: ["RRV", "BLS", "ALS", "CCT"],
              description: "Minimum required ambulance type",
            },
            severity: {
              type: "string",
              enum: ["HIGH", "LOW"],
              description: "Incident severity level",
            },
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
              description: "Medical triage classification",
            },
          },
        },
        response: {
          200: {
            description: "Dispatch successful",
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  ambulanceId: { type: "integer" },
                  ambulanceCallsign: { type: "string" },
                  ambulanceType: {
                    type: "string",
                    enum: ["RRV", "BLS", "ALS", "CCT"],
                  },
                  etaSeconds: { type: "integer" },
                  distanceMeters: { type: "integer" },
                  route: {
                    type: "object",
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
                },
              },
              message: { type: "string" },
            },
          },
          400: {
            description: "Invalid request",
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              details: { type: "object" },
            },
          },
          404: {
            description: "No ambulances available",
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          incidentId: string;
          lat: number;
          lng: number;
          requiredType?: string;
          severity?: string;
          triageType?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = DispatchRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.flatten(),
        });
      }

      const { incidentId, lat, lng, requiredType, severity, triageType } =
        parseResult.data;

      // Dispatch
      const result = await dispatchService.dispatchToIncident({
        incidentId,
        lat,
        lng,
        requiredType: requiredType as AmbulanceType | undefined,
        severity: severity as "HIGH" | "LOW",
        triageType,
      });

      if (!result.success) {
        return reply.status(404).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        data: {
          ambulanceId: result.ambulanceId,
          ambulanceCallsign: result.ambulanceCallsign,
          ambulanceType: result.ambulanceType,
          etaSeconds: result.etaSeconds,
          distanceMeters: result.distanceMeters,
          route: result.route,
        },
        message: result.message,
      });
    }
  );

  /**
   * GET /api/dispatch/candidates
   * Get ranked list of ambulance candidates for a location
   */
  fastify.get(
    "/api/dispatch/candidates",
    {
      schema: {
        tags: ["Dispatch"],
        summary: "Get ambulance candidates for a location",
        description:
          "Returns a ranked list of available ambulances that could be dispatched to a location, sorted by ETA.",
        querystring: {
          type: "object",
          required: ["lat", "lng"],
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
            requiredType: {
              type: "string",
              enum: ["RRV", "BLS", "ALS", "CCT"],
              description: "Minimum required ambulance type",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    callsign: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["RRV", "BLS", "ALS", "CCT"],
                    },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    hospitalId: { type: "integer" },
                    etaSeconds: { type: "integer" },
                    distanceMeters: { type: "integer" },
                  },
                },
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { lat: string; lng: string; requiredType?: string };
      }>,
      reply: FastifyReply
    ) => {
      const parseResult = CandidatesQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid query parameters",
          details: parseResult.error.flatten(),
        });
      }

      const { lat, lng, requiredType } = parseResult.data;

      const candidates = await dispatchService.getCandidates(
        lat,
        lng,
        requiredType as AmbulanceType | undefined
      );

      return reply.send({
        success: true,
        data: candidates,
        count: candidates.length,
      });
    }
  );

  /**
   * GET /api/dispatch/simulations
   * Get status of active simulations
   */
  fastify.get(
    "/api/dispatch/simulations",
    {
      schema: {
        tags: ["Dispatch"],
        summary: "Get active simulations count",
        description:
          "Returns the number of currently running dispatch simulations",
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
   * DELETE /api/dispatch/simulations/:incidentId
   * Cancel a running simulation
   */
  fastify.delete(
    "/api/dispatch/simulations/:incidentId",
    {
      schema: {
        tags: ["Dispatch"],
        summary: "Cancel a simulation",
        description:
          "Cancels a running dispatch simulation and resets the ambulance to IDLE",
        params: {
          type: "object",
          properties: {
            incidentId: { type: "string", description: "Incident ID" },
          },
          required: ["incidentId"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { incidentId: string } }>,
      reply: FastifyReply
    ) => {
      const { incidentId } = request.params;
      const cancelled = await simulationService.cancelSimulation(incidentId);

      if (!cancelled) {
        return reply.status(404).send({
          success: false,
          error: "Simulation not found",
        });
      }

      return reply.send({
        success: true,
        message: `Simulation for incident ${incidentId} cancelled`,
      });
    }
  );
}
