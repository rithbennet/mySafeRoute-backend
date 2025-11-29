import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import db from "../../shared/store/Database";
import {
  CreateIncidentSchema,
  AssignAmbulanceSchema,
} from "../../shared/types";
import type { Incident } from "../../shared/types";
import { hospitalScoringService } from "../routing";
import { generateId } from "../../shared/utils";
import { broadcastToDispatchers } from "../telemetry/WebSocketService";

// Inline schemas for OpenAPI documentation
const IncidentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    location: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
      },
    },
    triage: {
      type: "string",
      enum: ["STEMI", "Stroke", "Trauma", "Burns", "Pediatric", "General"],
    },
    status: {
      type: "string",
      enum: [
        "PENDING",
        "ASSIGNED",
        "EN_ROUTE",
        "ARRIVED",
        "TRANSPORTING",
        "COMPLETED",
        "CANCELLED",
      ],
    },
    assignedAmbulanceId: { type: "string", nullable: true },
    recommendedHospitalId: { type: "string", nullable: true },
    etaSeconds: { type: "integer", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const AmbulanceSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    callsign: { type: "string" },
    type: { type: "string" },
    status: { type: "string" },
    location: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
      },
    },
  },
};

const HospitalSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    location: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
      },
    },
    capabilities: {
      type: "array",
      items: { type: "string" },
    },
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
 * Incident Routes
 */
export async function incidentRoutes(fastify: FastifyInstance) {
  /**
   * GET /incidents
   * Returns all incidents
   */
  fastify.get(
    "/incidents",
    {
      schema: {
        tags: ["Incidents"],
        summary: "List all incidents",
        description:
          "Returns all incidents including completed and cancelled ones",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "array",
                items: IncidentSchema,
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const incidents = db.getIncidents();
      return reply.send({
        success: true,
        data: incidents,
        count: incidents.length,
      });
    }
  );

  /**
   * GET /incidents/active
   * Returns only active incidents
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
              data: {
                type: "array",
                items: IncidentSchema,
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const incidents = db.getActiveIncidents();
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
          "Returns a specific incident with assigned ambulance and recommended hospital details",
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
              data: {
                type: "object",
                properties: {
                  incident: IncidentSchema,
                  assignedAmbulance: AmbulanceSchema,
                  recommendedHospital: HospitalSchema,
                },
              },
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
      const incident = db.getIncident(id);

      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Get related data
      const ambulance = incident.assignedAmbulanceId
        ? db.getAmbulance(incident.assignedAmbulanceId)
        : null;
      const hospital = incident.recommendedHospitalId
        ? db.getHospital(incident.recommendedHospitalId)
        : null;

      return reply.send({
        success: true,
        data: {
          incident,
          assignedAmbulance: ambulance,
          recommendedHospital: hospital,
        },
      });
    }
  );

  /**
   * POST /incidents
   * Create a new incident
   * Flow:
   * 1. Save incident to store
   * 2. Call HospitalScoringService to find top hospitals
   * 3. Return incident with recommendations
   */
  fastify.post(
    "/incidents",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Create new incident",
        description: `
Creates a new emergency incident and automatically recommends the best hospitals based on:
- Triage type (STEMI, Stroke, Trauma, etc.)
- Hospital capabilities
- Distance and ETA
- Current hospital load

Returns top 3 hospital recommendations with routes.
        `,
        body: {
          type: "object",
          required: ["location", "triage"],
          properties: {
            location: {
              type: "object",
              required: ["lat", "lng"],
              properties: {
                lat: { type: "number" },
                lng: { type: "number" },
              },
            },
            triage: {
              type: "string",
              enum: [
                "STEMI",
                "Stroke",
                "Trauma",
                "Burns",
                "Pediatric",
                "General",
              ],
              description: "Emergency triage type",
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  incident: IncidentSchema,
                  recommendations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        hospital: HospitalSchema,
                        score: { type: "number" },
                        etaSeconds: { type: "integer" },
                        distanceMeters: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { location: { lat: number; lng: number }; triage: string };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = CreateIncidentSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
        });
      }

      const { location, triage } = parseResult.data;

      // Create incident
      const incident: Incident = {
        id: generateId(),
        location,
        triage,
        status: "PENDING",
        assignedAmbulanceId: null,
        recommendedHospitalId: null,
        route: null,
        etaSeconds: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Get hospital recommendations
      const topHospitals = await hospitalScoringService.rankHospitals(
        location,
        triage,
        3
      );

      // Set best hospital as recommendation
      const best = topHospitals[0];
      if (best) {
        incident.recommendedHospitalId = best.hospital.id;
        incident.route = best.route;
        incident.etaSeconds = best.etaSeconds;
      }

      // Save incident
      db.setIncident(incident);

      // Broadcast to dispatchers
      broadcastToDispatchers({
        type: "incident_update",
        action: "created",
        incident,
      });

      return reply.status(201).send({
        success: true,
        data: {
          incident,
          recommendations: topHospitals.map((h) => ({
            hospital: h.hospital,
            score: h.score,
            etaSeconds: h.etaSeconds,
            distanceMeters: h.distanceMeters,
          })),
        },
      });
    }
  );

  /**
   * POST /incidents/:id/assign
   * Assign an ambulance to an incident
   */
  fastify.post(
    "/incidents/:id/assign",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Assign ambulance to incident",
        description:
          "Assigns an available ambulance to an incident and updates both statuses",
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
              type: "string",
              description: "ID of the ambulance to assign",
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
                  ambulance: AmbulanceSchema,
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
        Body: { ambulanceId: string };
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

      const { ambulanceId } = parseResult.data;

      // Check incident exists
      const incident = db.getIncident(id);
      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      // Check ambulance exists and is available
      const ambulance = db.getAmbulance(ambulanceId);
      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      if (ambulance.status !== "AVAILABLE") {
        return reply.status(400).send({
          success: false,
          error: "Ambulance is not available",
        });
      }

      // Update incident
      const updatedIncident = db.updateIncident(id, {
        assignedAmbulanceId: ambulanceId,
        status: "ASSIGNED",
      });

      // Update ambulance
      db.updateAmbulance(ambulanceId, {
        status: "BUSY",
      });

      // Broadcast updates
      broadcastToDispatchers({
        type: "incident_update",
        action: "assigned",
        incident: updatedIncident,
        ambulanceId,
      });

      broadcastToDispatchers({
        type: "ambulance_update",
        action: "assigned",
        ambulanceId,
        incidentId: id,
      });

      return reply.send({
        success: true,
        data: {
          incident: updatedIncident,
          ambulance: db.getAmbulance(ambulanceId),
        },
        message: "Ambulance assigned successfully",
      });
    }
  );

  /**
   * PATCH /incidents/:id/status
   * Update incident status
   */
  fastify.patch(
    "/incidents/:id/status",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Update incident status",
        description:
          "Update the status of an incident. If completed/cancelled, the assigned ambulance is freed.",
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
                "ASSIGNED",
                "EN_ROUTE",
                "ARRIVED",
                "TRANSPORTING",
                "COMPLETED",
                "CANCELLED",
              ],
              description: "New incident status",
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
      const { status } = request.body;

      const incident = db.getIncident(id);
      if (!incident) {
        return reply.status(404).send({
          success: false,
          error: "Incident not found",
        });
      }

      const updatedIncident = db.updateIncident(id, { status: status as any });

      // If completed or cancelled, free up the ambulance
      if (
        ["COMPLETED", "CANCELLED"].includes(status) &&
        incident.assignedAmbulanceId
      ) {
        db.updateAmbulance(incident.assignedAmbulanceId, {
          status: "AVAILABLE",
        });
      }

      // Broadcast update
      broadcastToDispatchers({
        type: "incident_update",
        action: "status_changed",
        incident: updatedIncident,
        newStatus: status,
      });

      return reply.send({
        success: true,
        data: updatedIncident,
      });
    }
  );
}
