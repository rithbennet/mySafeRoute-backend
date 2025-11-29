import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import db from "../../shared/store/Database";
import { CreateHazardSchema } from "../../shared/types";
import type { Hazard } from "../../shared/types";
import { generateId } from "../../shared/utils";
import { broadcastToDispatchers } from "../telemetry/WebSocketService";

// Inline schemas for OpenAPI documentation
const HazardSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: ["FLOOD", "ACCIDENT", "ROADBLOCK", "CONSTRUCTION", "OTHER"],
    },
    description: { type: "string" },
    bounds: {
      type: "object",
      properties: {
        minLat: { type: "number" },
        maxLat: { type: "number" },
        minLng: { type: "number" },
        maxLng: { type: "number" },
      },
    },
    active: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
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
 * Hazard Routes
 */
export async function hazardRoutes(fastify: FastifyInstance) {
  /**
   * GET /hazards
   * Returns all hazards (for map layers)
   */
  fastify.get(
    "/hazards",
    {
      schema: {
        tags: ["Hazards"],
        summary: "List all hazards",
        description:
          "Returns all hazards including inactive ones for map display",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "array",
                items: HazardSchema,
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
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
    {
      schema: {
        tags: ["Hazards"],
        summary: "List active hazards",
        description: "Returns only active hazards that affect routing",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "array",
                items: HazardSchema,
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
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
    {
      schema: {
        tags: ["Hazards"],
        summary: "Get hazard by ID",
        description: "Returns a specific hazard by its ID",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Hazard ID" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: HazardSchema,
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
    {
      schema: {
        tags: ["Hazards"],
        summary: "Create new hazard",
        description:
          "Create a new hazard zone (flood, accident, road closure) that affects routing",
        body: {
          type: "object",
          required: ["type", "description", "bounds"],
          properties: {
            type: {
              type: "string",
              enum: ["FLOOD", "ACCIDENT", "ROADBLOCK", "CONSTRUCTION", "OTHER"],
              description: "Type of hazard",
            },
            description: {
              type: "string",
              description: "Description of the hazard",
            },
            bounds: {
              type: "object",
              required: ["minLat", "maxLat", "minLng", "maxLng"],
              description: "Bounding box of the hazard area",
              properties: {
                minLat: { type: "number" },
                maxLat: { type: "number" },
                minLng: { type: "number" },
                maxLng: { type: "number" },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: HazardSchema,
              message: { type: "string" },
            },
          },
          400: ErrorResponseSchema,
        },
      },
    },
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
    {
      schema: {
        tags: ["Hazards"],
        summary: "Update hazard",
        description: "Update a hazard's active status or description",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Hazard ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            active: {
              type: "boolean",
              description: "Whether the hazard is active",
            },
            description: {
              type: "string",
              description: "Updated description",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: HazardSchema,
            },
          },
          404: ErrorResponseSchema,
        },
      },
    },
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
    {
      schema: {
        tags: ["Hazards"],
        summary: "Delete hazard",
        description: "Permanently delete a hazard",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Hazard ID" },
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
