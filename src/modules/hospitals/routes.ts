import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../shared/store/prisma";
import { z } from "zod";

// Validation schemas
const UpdateHospitalStatusSchema = z.object({
  status: z.enum(["OPEN", "DIVERTING", "CLOSED"]).optional(),
  load: z.number().min(0).max(100).optional(),
});

/**
 * Hospital Routes
 * Now using Prisma with real PostgreSQL database
 */
export async function hospitalRoutes(fastify: FastifyInstance) {
  /**
   * GET /hospitals
   * Returns all hospitals with their current status and ambulance counts
   */
  fastify.get(
    "/hospitals",
    {
      schema: {
        tags: ["Hospitals"],
        summary: "List all hospitals",
        description:
          "Returns all hospitals in the Subang Jaya area with their capabilities and ambulance counts",
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
                    name: { type: "string" },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                      },
                    },
                    capabilities: { type: "array", items: { type: "string" } },
                    ambulanceCount: { type: "integer" },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                  },
                },
              },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const hospitals = await prisma.hospital.findMany({
        include: {
          _count: {
            select: { ambulances: true },
          },
        },
        orderBy: { name: "asc" },
      });

      // Transform to API format
      const data = hospitals.map((h) => ({
        id: h.id,
        name: h.name,
        location: { lat: h.lat, lng: h.lng },
        capabilities: h.capabilities,
        ambulanceCount: h._count.ambulances,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      }));

      return reply.send({
        success: true,
        data,
        count: data.length,
      });
    }
  );

  /**
   * GET /hospitals/:id
   * Returns a specific hospital with its ambulances
   */
  fastify.get(
    "/hospitals/:id",
    {
      schema: {
        tags: ["Hospitals"],
        summary: "Get hospital by ID",
        description: "Returns a specific hospital with all its ambulances",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Hospital ID" },
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
                  id: { type: "integer" },
                  name: { type: "string" },
                  location: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  capabilities: { type: "array", items: { type: "string" } },
                  ambulances: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
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
                    },
                  },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
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
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "Invalid hospital ID",
        });
      }

      const hospital = await prisma.hospital.findUnique({
        where: { id },
        include: {
          ambulances: true,
        },
      });

      if (!hospital) {
        return reply.status(404).send({
          success: false,
          error: "Hospital not found",
        });
      }

      return reply.send({
        success: true,
        data: {
          id: hospital.id,
          name: hospital.name,
          location: { lat: hospital.lat, lng: hospital.lng },
          capabilities: hospital.capabilities,
          ambulances: hospital.ambulances.map((a) => ({
            id: a.id,
            callsign: a.callsign,
            type: a.type,
            status: a.status,
            location: { lat: a.currentLat, lng: a.currentLng },
          })),
          createdAt: hospital.createdAt,
          updatedAt: hospital.updatedAt,
        },
      });
    }
  );

  /**
   * POST /hospitals/:id/status
   * Update hospital status and/or load (for future use when we add status/load fields)
   * For now, this is a placeholder that returns the hospital data
   */
  fastify.post(
    "/hospitals/:id/status",
    {
      schema: {
        tags: ["Hospitals"],
        summary: "Update hospital status",
        description:
          "Update hospital diverting status and current load percentage",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Hospital ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["OPEN", "DIVERTING", "CLOSED"],
              description: "Hospital status",
            },
            load: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Current load percentage (0-100)",
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
                  id: { type: "integer" },
                  name: { type: "string" },
                  location: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  capabilities: { type: "array", items: { type: "string" } },
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
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status?: string; load?: number };
      }>,
      reply: FastifyReply
    ) => {
      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "Invalid hospital ID",
        });
      }

      const hospital = await prisma.hospital.findUnique({
        where: { id },
      });

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

      // Note: Status and load fields would need to be added to the Prisma schema
      // For now, we just return the current hospital data
      return reply.send({
        success: true,
        data: {
          id: hospital.id,
          name: hospital.name,
          location: { lat: hospital.lat, lng: hospital.lng },
          capabilities: hospital.capabilities,
        },
        message:
          "Hospital status endpoint ready (status/load fields pending schema update)",
      });
    }
  );
}
