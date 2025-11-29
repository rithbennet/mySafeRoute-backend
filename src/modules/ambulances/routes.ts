import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import db from "../../shared/store/Database";

/**
 * Ambulance Routes
 */
export async function ambulanceRoutes(fastify: FastifyInstance) {
  /**
   * GET /ambulances
   * Returns all ambulances with their current status and location
   */
  fastify.get(
    "/ambulances",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ambulances = db.getAmbulances();
      return reply.send({
        success: true,
        data: ambulances,
        count: ambulances.length,
      });
    }
  );

  /**
   * GET /ambulances/available
   * Returns only available ambulances
   */
  fastify.get(
    "/ambulances/available",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ambulances = db.getAvailableAmbulances();
      return reply.send({
        success: true,
        data: ambulances,
        count: ambulances.length,
      });
    }
  );

  /**
   * GET /ambulances/:id
   * Returns a specific ambulance
   */
  fastify.get(
    "/ambulances/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const ambulance = db.getAmbulance(id);

      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      return reply.send({
        success: true,
        data: ambulance,
      });
    }
  );

  /**
   * PATCH /ambulances/:id/status
   * Update ambulance status
   */
  fastify.patch(
    "/ambulances/:id/status",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body;

      const ambulance = db.getAmbulance(id);
      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      const validStatuses = ["AVAILABLE", "BUSY", "OFFLINE"];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const updated = db.updateAmbulance(id, { status: status as any });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );
}
