import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import db from "../../shared/store/Database";
import { UpdateHospitalStatusSchema } from "../../shared/types";

/**
 * Hospital Routes
 */
export async function hospitalRoutes(fastify: FastifyInstance) {
  /**
   * GET /hospitals
   * Returns all hospitals with their current status
   */
  fastify.get(
    "/hospitals",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const hospitals = db.getHospitals();
      return reply.send({
        success: true,
        data: hospitals,
        count: hospitals.length,
      });
    }
  );

  /**
   * GET /hospitals/:id
   * Returns a specific hospital
   */
  fastify.get(
    "/hospitals/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const hospital = db.getHospital(id);

      if (!hospital) {
        return reply.status(404).send({
          success: false,
          error: "Hospital not found",
        });
      }

      return reply.send({
        success: true,
        data: hospital,
      });
    }
  );

  /**
   * POST /hospitals/:id/status
   * Update hospital status and/or load
   */
  fastify.post(
    "/hospitals/:id/status",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status?: string; load?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const hospital = db.getHospital(id);

      if (!hospital) {
        return reply.status(404).send({
          success: false,
          error: "Hospital not found",
        });
      }

      // Validate input
      const parseResult = UpdateHospitalStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten(),
        });
      }

      const updates = parseResult.data;
      const updated = db.updateHospital(id, updates);

      return reply.send({
        success: true,
        data: updated,
        message: "Hospital status updated",
      });
    }
  );
}
