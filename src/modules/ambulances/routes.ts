import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma, AmbulanceStatus } from "../../shared/store/prisma";
import { z } from "zod";

// Validation schema for status update
const UpdateAmbulanceStatusSchema = z.object({
  status: z.enum(["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"]),
});

// Validation schema for location update
const UpdateAmbulanceLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Ambulance Routes
 * Now using Prisma with real PostgreSQL database
 */
export async function ambulanceRoutes(fastify: FastifyInstance) {
  /**
   * GET /ambulances
   * Returns all ambulances with their current status and location
   */
  fastify.get(
    "/ambulances",
    {
      schema: {
        tags: ["Ambulances"],
        summary: "List all ambulances",
        description:
          "Returns all ambulances with their current status, location, and assigned hospital",
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
                      enum: ["BLS", "ALS", "CCT", "RRV"],
                    },
                    status: {
                      type: "string",
                      enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
                    },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                      },
                    },
                    hospital: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        name: { type: "string" },
                      },
                    },
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
      const ambulances = await prisma.ambulance.findMany({
        include: {
          hospital: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { callsign: "asc" },
      });

      const data = ambulances.map((a) => ({
        id: a.id,
        callsign: a.callsign,
        type: a.type,
        status: a.status,
        location: { lat: a.currentLat, lng: a.currentLng },
        hospital: a.hospital,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));

      return reply.send({
        success: true,
        data,
        count: data.length,
      });
    }
  );

  /**
   * GET /ambulances/available
   * Returns only idle/available ambulances
   */
  fastify.get(
    "/ambulances/available",
    {
      schema: {
        tags: ["Ambulances"],
        summary: "List available ambulances",
        description:
          "Returns only ambulances with IDLE status that can be dispatched",
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
                      enum: ["BLS", "ALS", "CCT", "RRV"],
                    },
                    status: {
                      type: "string",
                      enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
                    },
                    location: {
                      type: "object",
                      properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                      },
                    },
                    hospital: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        name: { type: "string" },
                      },
                    },
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
      const ambulances = await prisma.ambulance.findMany({
        where: {
          status: AmbulanceStatus.IDLE,
        },
        include: {
          hospital: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { callsign: "asc" },
      });

      const data = ambulances.map((a) => ({
        id: a.id,
        callsign: a.callsign,
        type: a.type,
        status: a.status,
        location: { lat: a.currentLat, lng: a.currentLng },
        hospital: a.hospital,
      }));

      return reply.send({
        success: true,
        data,
        count: data.length,
      });
    }
  );

  /**
   * GET /ambulances/:id
   * Returns a specific ambulance
   */
  fastify.get(
    "/ambulances/:id",
    {
      schema: {
        tags: ["Ambulances"],
        summary: "Get ambulance by ID",
        description:
          "Returns a specific ambulance with full details including its home hospital",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Ambulance ID" },
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
                  callsign: { type: "string" },
                  type: { type: "string", enum: ["BLS", "ALS", "CCT", "RRV"] },
                  status: {
                    type: "string",
                    enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
                  },
                  location: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  hospital: {
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
          error: "Invalid ambulance ID",
        });
      }

      const ambulance = await prisma.ambulance.findUnique({
        where: { id },
        include: {
          hospital: true,
        },
      });

      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      return reply.send({
        success: true,
        data: {
          id: ambulance.id,
          callsign: ambulance.callsign,
          type: ambulance.type,
          status: ambulance.status,
          location: { lat: ambulance.currentLat, lng: ambulance.currentLng },
          hospital: {
            id: ambulance.hospital.id,
            name: ambulance.hospital.name,
            location: {
              lat: ambulance.hospital.lat,
              lng: ambulance.hospital.lng,
            },
          },
          createdAt: ambulance.createdAt,
          updatedAt: ambulance.updatedAt,
        },
      });
    }
  );

  /**
   * PATCH /ambulances/:id/status
   * Update ambulance status
   */
  fastify.patch(
    "/ambulances/:id/status",
    {
      schema: {
        tags: ["Ambulances"],
        summary: "Update ambulance status",
        description: "Update the operational status of an ambulance",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Ambulance ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
              description: "New ambulance status",
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
                  callsign: { type: "string" },
                  type: { type: "string", enum: ["BLS", "ALS", "CCT", "RRV"] },
                  status: {
                    type: "string",
                    enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
                  },
                  location: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                  hospital: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      name: { type: "string" },
                    },
                  },
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
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: string };
      }>,
      reply: FastifyReply
    ) => {
      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "Invalid ambulance ID",
        });
      }

      // Validate input
      const parseResult = UpdateAmbulanceStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid status",
          details: parseResult.error.flatten(),
        });
      }

      const ambulance = await prisma.ambulance.findUnique({
        where: { id },
      });

      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      const updated = await prisma.ambulance.update({
        where: { id },
        data: {
          status: parseResult.data.status as AmbulanceStatus,
        },
        include: {
          hospital: {
            select: { id: true, name: true },
          },
        },
      });

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          callsign: updated.callsign,
          type: updated.type,
          status: updated.status,
          location: { lat: updated.currentLat, lng: updated.currentLng },
          hospital: updated.hospital,
        },
      });
    }
  );

  /**
   * PATCH /ambulances/:id/location
   * Update ambulance GPS location
   */
  fastify.patch(
    "/ambulances/:id/location",
    {
      schema: {
        tags: ["Ambulances"],
        summary: "Update ambulance location",
        description:
          "Update the GPS coordinates of an ambulance (used by paramedic app)",
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Ambulance ID" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: {
              type: "number",
              minimum: -90,
              maximum: 90,
              description: "Latitude",
            },
            lng: {
              type: "number",
              minimum: -180,
              maximum: 180,
              description: "Longitude",
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
                  callsign: { type: "string" },
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
        Body: { lat: number; lng: number };
      }>,
      reply: FastifyReply
    ) => {
      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "Invalid ambulance ID",
        });
      }

      // Validate input
      const parseResult = UpdateAmbulanceLocationSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid location",
          details: parseResult.error.flatten(),
        });
      }

      const ambulance = await prisma.ambulance.findUnique({
        where: { id },
      });

      if (!ambulance) {
        return reply.status(404).send({
          success: false,
          error: "Ambulance not found",
        });
      }

      const updated = await prisma.ambulance.update({
        where: { id },
        data: {
          currentLat: parseResult.data.lat,
          currentLng: parseResult.data.lng,
        },
      });

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          callsign: updated.callsign,
          location: { lat: updated.currentLat, lng: updated.currentLng },
        },
      });
    }
  );
}
