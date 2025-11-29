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
