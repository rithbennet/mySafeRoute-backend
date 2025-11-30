import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  prisma,
  AmbulanceStatus,
  IncidentStatus,
} from "../../shared/store/prisma";
import {
  dispatchService,
  routingService,
  simulationService,
} from "../../services";
import { broadcastToDispatchers } from "../telemetry/WebSocketService";
import type { AmbulanceType } from "../../../generated/prisma/client";

// ============ Validation Schemas ============

const AssignAmbulanceSchema = z.object({
  ambulanceId: z.number().int().positive(),
  dispatcherNotes: z.string().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "DISPATCHED",
    "EN_ROUTE",
    "ON_SCENE",
    "TRANSPORTING",
    "COMPLETED",
    "CANCELLED",
  ]),
});

// ============ OpenAPI Schemas ============

const IncidentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    lat: { type: "number" },
    lng: { type: "number" },
    category: {
      type: "string",
      enum: ["MEDICAL", "FIRE", "ACCIDENT", "OTHER"],
    },
    severity: { type: "string", enum: ["HIGH", "LOW"] },
    triageType: {
      type: "string",
      enum: ["STEMI", "Stroke", "Trauma", "Burns", "Pediatric", "General"],
    },
    status: {
      type: "string",
      enum: [
        "PENDING",
        "DISPATCHED",
        "EN_ROUTE",
        "ON_SCENE",
        "TRANSPORTING",
        "COMPLETED",
        "CANCELLED",
      ],
    },
    description: { type: "string", nullable: true },
    dispatcherNotes: { type: "string", nullable: true },
    assignedAmbulanceId: { type: "integer", nullable: true },
    destinationHospitalId: { type: "integer", nullable: true },
    etaSeconds: { type: "integer", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const CandidateSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    callsign: { type: "string" },
    type: { type: "string", enum: ["RRV", "BLS", "ALS", "CCT"] },
    lat: { type: "number" },
    lng: { type: "number" },
    hospitalId: { type: "integer" },
    hospitalName: { type: "string" },
    etaSeconds: { type: "integer" },
    distanceMeters: { type: "integer" },
  },
};

const ErrorResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    error: { type: "string" },
  },
};

/**
 * Incident Routes (Prisma-based)
 */
export async function incidentRoutes(fastify: FastifyInstance) {
  /**
   * GET /incidents
   * Returns all incidents with optional status filter
   */
  fastify.get(
    "/incidents",
    {
      schema: {
        tags: ["Incidents"],
        summary: "List all incidents",
        description:
          "Returns all incidents. Use ?status=PENDING to filter by status.",
        querystring: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: [
                "PENDING",
                "DISPATCHED",
                "EN_ROUTE",
                "ON_SCENE",
                "TRANSPORTING",
                "COMPLETED",
                "CANCELLED",
              ],
              description: "Filter by incident status",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "array", items: IncidentSchema },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { status?: string } }>,
      reply: FastifyReply
    ) => {
      const { status } = request.query;

      const where = status ? { status: status as IncidentStatus } : {};

      const incidents = await prisma.incident.findMany({
        where,
        include: {
          assignedAmbulance: {
            select: { id: true, callsign: true, type: true },
          },
          destinationHospital: {
            select: { id: true, name: true },
          },
          reportedBy: {
            select: { id: true, name: true, phone: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({
        success: true,
        data: incidents,
        count: incidents.length,
      });
    }
  );

  /**
   * GET /incidents/active
   * Returns only active incidents (not completed or cancelled)
   */
  fastify.get(
    "/incidents/active",
    {
      schema: {
        tags: ["Incidents"],
        summary: "List active incidents",
        description:
          "Returns only incidents that are not completed or cancelled",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "array", items: IncidentSchema },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const incidents = await prisma.incident.findMany({
        where: {
          status: {
            notIn: [IncidentStatus.COMPLETED, IncidentStatus.CANCELLED],
          },
        },
        include: {
          assignedAmbulance: {
            select: { id: true, callsign: true, type: true, status: true },
          },
          destinationHospital: {
            select: { id: true, name: true },
          },
          reportedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({
        success: true,
        data: incidents,
        count: incidents.length,
      });
    }
  );

  /**
   * GET /incidents/:id
   * Returns a specific incident with full details
   */
  fastify.get(
    "/incidents/:id",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Get incident by ID",
        description:
          "Returns a specific incident with assigned ambulance and hospital details",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Incident ID (UUID)" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: IncidentSchema,
            },
          },
          404: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      const incident = await prisma.incident.findUnique({
        where: { id },
        include: {
          assignedAmbulance: true,
          destinationHospital: true,
          reportedBy: true,
        },
      });

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      return reply.send({
        success: true,
        data: incident,
      });
    }
  );

  /**
   * GET /incidents/:id/candidates
   * Returns ranked list of ambulance candidates for this incident
   */
  fastify.get(
    "/incidents/:id/candidates",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Get ambulance candidates for incident",
        description:
          "Returns a ranked list of available ambulances sorted by ETA to the incident location",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Incident ID" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "array", items: CandidateSchema },
              count: { type: "integer" },
            },
          },
          404: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Get incident
      const incident = await prisma.incident.findUnique({
        where: { id },
      });

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Get all IDLE ambulances with their hospitals
      const idleAmbulances = await prisma.ambulance.findMany({
        where: { status: AmbulanceStatus.IDLE },
        include: { hospital: { select: { id: true, name: true } } },
      });

      // Calculate ETA for each ambulance
      const candidates = idleAmbulances.map((ambulance) => {
        const route = routingService.calculateMockRoute(
          { lat: ambulance.currentLat, lng: ambulance.currentLng },
          { lat: incident.lat, lng: incident.lng }
        );

        return {
          id: ambulance.id,
          callsign: ambulance.callsign,
          type: ambulance.type,
          lat: ambulance.currentLat,
          lng: ambulance.currentLng,
          hospitalId: ambulance.hospitalId,
          hospitalName: ambulance.hospital.name,
          etaSeconds: route.etaSeconds,
          distanceMeters: route.distanceMeters,
        };
      });

      // Sort by ETA (closest first)
      candidates.sort((a, b) => a.etaSeconds - b.etaSeconds);

      return reply.send({
        success: true,
        data: candidates,
        count: candidates.length,
      });
    }
  );

  /**
   * POST /incidents/:id/assign
   * Assign an ambulance to an incident and IMMEDIATELY start simulation
   */
  fastify.post(
    "/incidents/:id/assign",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Assign ambulance and start simulation",
        description: `
Assigns an ambulance to an incident and **immediately** starts the movement simulation.

**Flow:**
1. Validates ambulance is IDLE
2. Updates Incident status to DISPATCHED
3. Updates Ambulance status to EN_ROUTE
4. **Starts live simulation** - ambulance moves on map every 1 second
5. Broadcasts INCIDENT_UPDATE and AMBULANCE_UPDATE via WebSocket

The frontend will receive real-time position updates without any further API calls.
        `,
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Incident ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["ambulanceId"],
          properties: {
            ambulanceId: {
              type: "integer",
              description: "ID of the ambulance to assign",
            },
            dispatcherNotes: {
              type: "string",
              description: "Optional notes from dispatcher",
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
                  incident: IncidentSchema,
                  ambulance: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      callsign: { type: "string" },
                      type: { type: "string" },
                      status: { type: "string" },
                    },
                  },
                  etaSeconds: { type: "integer" },
                  simulationStarted: { type: "boolean" },
                },
              },
              message: { type: "string" },
            },
          },
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { ambulanceId: number; dispatcherNotes?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      // Validate input
      const parseResult = AssignAmbulanceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
        });
      }

      const { ambulanceId, dispatcherNotes } = parseResult.data;

      // Get incident
      const incident = await prisma.incident.findUnique({
        where: { id },
      });

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Get ambulance
      const ambulance = await prisma.ambulance.findUnique({
        where: { id: ambulanceId },
        include: { hospital: true },
      });

      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      if (ambulance.status !== AmbulanceStatus.IDLE) {
        return reply.status(400).send({
          success: false,
          error: `Ambulance is not available (current status: ${ambulance.status})`,
        });
      }

      // Calculate ETA
      const route = routingService.calculateMockRoute(
        { lat: ambulance.currentLat, lng: ambulance.currentLng },
        { lat: incident.lat, lng: incident.lng }
      );

      // Update incident
      const updatedIncident = await prisma.incident.update({
        where: { id },
        data: {
          assignedAmbulanceId: ambulanceId,
          status: IncidentStatus.DISPATCHED,
          dispatcherNotes: dispatcherNotes || null,
          etaSeconds: route.etaSeconds,
          routeGeometry: route.geometry,
        },
      });

      // Update ambulance status
      const updatedAmbulance = await prisma.ambulance.update({
        where: { id: ambulanceId },
        data: { status: AmbulanceStatus.EN_ROUTE },
      });

      // Broadcast INCIDENT_UPDATE
      broadcastToDispatchers({
        type: "INCIDENT_UPDATE",
        incidentId: id,
        status: "DISPATCHED",
        assignedAmbulanceId: ambulanceId,
        etaSeconds: route.etaSeconds,
        timestamp: new Date().toISOString(),
      });

      // Start simulation IMMEDIATELY (non-blocking)
      setImmediate(async () => {
        try {
          console.log(`\n🚀 Starting simulation for incident ${id}`);
          await simulationService.startLifecycle({
            ambulanceId,
            incidentId: id,
            ambulanceLocation: {
              lat: ambulance.currentLat,
              lng: ambulance.currentLng,
            },
            incidentLocation: {
              lat: incident.lat,
              lng: incident.lng,
            },
            severity: incident.severity as "HIGH" | "LOW",
            ambulanceType: ambulance.type as AmbulanceType,
            triageType: incident.triageType,
          });
        } catch (error) {
          console.error(`❌ Simulation error for incident ${id}:`, error);
        }
      });

      return reply.send({
        success: true,
        data: {
          incident: updatedIncident,
          ambulance: {
            id: updatedAmbulance.id,
            callsign: updatedAmbulance.callsign,
            type: updatedAmbulance.type,
            status: updatedAmbulance.status,
          },
          etaSeconds: route.etaSeconds,
          simulationStarted: true,
        },
        message: `Ambulance ${ambulance.callsign} assigned and simulation started`,
      });
    }
  );

  /**
   * PATCH /incidents/:id/status
   * Update incident status manually
   */
  fastify.patch(
    "/incidents/:id/status",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Update incident status",
        description:
          "Manually update incident status. If completed/cancelled, frees the ambulance.",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Incident ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: [
                "PENDING",
                "DISPATCHED",
                "EN_ROUTE",
                "ON_SCENE",
                "TRANSPORTING",
                "COMPLETED",
                "CANCELLED",
              ],
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: IncidentSchema,
            },
          },
          404: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      const parseResult = UpdateStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid status",
          details: parseResult.error.flatten(),
        });
      }

      const { status } = parseResult.data;

      const incident = await prisma.incident.findUnique({
        where: { id },
      });

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Update incident
      const updatedIncident = await prisma.incident.update({
        where: { id },
        data: { status: status as IncidentStatus },
      });

      // If completed or cancelled, free the ambulance
      if (
        ["COMPLETED", "CANCELLED"].includes(status) &&
        incident.assignedAmbulanceId
      ) {
        await prisma.ambulance.update({
          where: { id: incident.assignedAmbulanceId },
          data: { status: AmbulanceStatus.IDLE },
        });

        // Cancel any running simulation
        await simulationService.cancelSimulation(id);
      }

      // Broadcast status change
      broadcastToDispatchers({
        type: "INCIDENT_UPDATE",
        incidentId: id,
        status,
        timestamp: new Date().toISOString(),
      });

      return reply.send({
        success: true,
        data: updatedIncident,
      });
    }
  );

  /**
   * DELETE /incidents/:id
   * Cancel and delete an incident
   */
  fastify.delete(
    "/incidents/:id",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Delete incident",
        description: "Cancels simulation and deletes the incident",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Incident ID" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          404: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      const incident = await prisma.incident.findUnique({
        where: { id },
      });

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Cancel simulation if running
      await simulationService.cancelSimulation(id);

      // Free ambulance if assigned
      if (incident.assignedAmbulanceId) {
        await prisma.ambulance.update({
          where: { id: incident.assignedAmbulanceId },
          data: { status: AmbulanceStatus.IDLE },
        });
      }

      // Delete incident
      await prisma.incident.delete({
        where: { id },
      });

      // Broadcast deletion
      broadcastToDispatchers({
        type: "INCIDENT_DELETED",
        incidentId: id,
        timestamp: new Date().toISOString(),
      });

      return reply.send({
        success: true,
        message: "Incident deleted",
      });
    }
  );
}
