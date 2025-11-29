import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import db from "../../shared/store/Database";
import { CreateHazardSchema } from "../../shared/types";
import type { Hazard } from "../../shared/types";
import { generateId } from "../../shared/utils";
import { broadcastToDispatchers } from "../telemetry/WebSocketService";

/**
 * Hazard Routes
 */
export async function hazardRoutes(fastify: FastifyInstance) {
  /**
   * GET /hazards
   * Returns all hazards (for map layers)
   */
  fastify.get(
    "/hazards",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const hazards = db.getHazards();
      return reply.send({
        success: true,
        data: hazards,
        count: hazards.length,
      });
    }
  );

  /**
   * GET /hazards/active
   * Returns only active hazards
   */
  fastify.get(
    "/hazards/active",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const hazards = db.getActiveHazards();
      return reply.send({
        success: true,
        data: hazards,
        count: hazards.length,
      });
    }
  );

  /**
   * GET /hazards/:id
   * Returns a specific hazard
   */
  fastify.get(
    "/hazards/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const hazard = db.getHazard(id);

      if (!hazard) {
        return reply.status(404).send({
          success: false,
          error: "Hazard not found",
        });
      }

      return reply.send({
        success: true,
        data: hazard,
      });
    }
  );

  /**
   * POST /hazards
   * Create a new hazard (for dispatcher to mark road closures)
   */
  fastify.post(
    "/hazards",
    async (
      request: FastifyRequest<{
        Body: {
          type: string;
          description: string;
          bounds: {
            minLat: number;
            maxLat: number;
            minLng: number;
            maxLng: number;
          };
        };
      }>,
      reply: FastifyReply
    ) => {
      // Validate input
      const parseResult = CreateHazardSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
        });
      }

      const { type, description, bounds } = parseResult.data;

      // Create hazard
      const hazard: Hazard = {
        id: generateId(),
        type,
        description,
        bounds,
        active: true,
        createdAt: new Date(),
      };

      // Save hazard
      db.setHazard(hazard);

      // Broadcast to dispatchers
      broadcastToDispatchers({
        type: "hazard_update",
        action: "created",
        hazard,
      });

      return reply.status(201).send({
        success: true,
        data: hazard,
        message: "Hazard created successfully",
      });
    }
  );

  /**
   * PATCH /hazards/:id
   * Update a hazard (toggle active status)
   */
  fastify.patch(
    "/hazards/:id",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { active?: boolean; description?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { active, description } = request.body;

      const hazard = db.getHazard(id);
      if (!hazard) {
        return reply.status(404).send({
          success: false,
          error: "Hazard not found",
        });
      }

      const updates: Partial<Hazard> = {};
      if (typeof active === "boolean") updates.active = active;
      if (description) updates.description = description;

      const updated = db.updateHazard(id, updates);

      // Broadcast update
      broadcastToDispatchers({
        type: "hazard_update",
        action: "updated",
        hazard: updated,
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * DELETE /hazards/:id
   * Delete a hazard
   */
  fastify.delete(
    "/hazards/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      const hazard = db.getHazard(id);
      if (!hazard) {
        return reply.status(404).send({
          success: false,
          error: "Hazard not found",
        });
      }

      db.deleteHazard(id);

      // Broadcast deletion
      broadcastToDispatchers({
        type: "hazard_update",
        action: "deleted",
        hazardId: id,
      });

      return reply.send({
        success: true,
        message: "Hazard deleted successfully",
      });
    }
  );
}
