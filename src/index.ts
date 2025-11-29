import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

// Import modules
import { hospitalRoutes } from "./modules/hospitals";
import { ambulanceRoutes } from "./modules/ambulances";
import { incidentRoutes } from "./modules/incidents";
import { hazardRoutes } from "./modules/hazards";
import { telemetryRoutes } from "./modules/telemetry";
import { dispatchRoutes } from "./modules/dispatch";
import { routingRoutes } from "./modules/routing";

// Import Prisma client for connection check
import { prisma } from "./shared/store/prisma";

/**
 * Build and configure Fastify application
 */
async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
    },
  });

  // Register Swagger
  // Determine Swagger/OpenAPI server URL from environment (fallback to localhost)
  const swaggerServerUrl =
    process.env.SWAGGER_SERVER_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "MySafeRoute API",
        description: `
## Emergency Medical Services Routing System

This API provides endpoints for managing emergency dispatch operations in the Klang Valley / Subang Jaya area.

### Features
- **Hospitals**: View hospital locations, capabilities, and ambulance counts
- **Ambulances**: Track ambulance locations and status in real-time
- **Incidents**: Create and manage emergency incidents
- **Hazards**: Mark road hazards and closures for route optimization
- **Auto-Dispatch**: Intelligent ambulance assignment with ETA calculation
- **Live Simulation**: Real-time lifecycle simulation with WebSocket updates

### Authentication
Currently, no authentication is required for MVP. Admin endpoints may require a token in the future.

### WebSocket Endpoints
- \`ws://localhost:3000/ws/telemetry\` - General telemetry updates
- \`ws://localhost:3000/ws/dispatch\` - Dispatch dashboard updates (AMBULANCE_UPDATE, HOSPITAL_SELECTED, SIMULATION_COMPLETE)
        `,
        version: "1.0.0",
        contact: {
          name: "MySafeRoute Team",
        },
      },
      servers: [
        {
          url: swaggerServerUrl,
          description: swaggerServerUrl.includes("localhost")
            ? "Local development server"
            : "Configured server",
        },
      ],
      tags: [
        { name: "Hospitals", description: "Hospital management endpoints" },
        {
          name: "Ambulances",
          description: "Ambulance tracking and management",
        },
        { name: "Incidents", description: "Emergency incident management" },
        { name: "Hazards", description: "Road hazard management" },
        { name: "Dispatch", description: "Auto-dispatch and simulation" },
        {
          name: "Routing",
          description: "Route calculation with Google Routes API",
        },
        { name: "System", description: "System health and info" },
      ],
      components: {
        schemas: {
          Location: {
            type: "object",
            properties: {
              lat: { type: "number", description: "Latitude", example: 3.0757 },
              lng: {
                type: "number",
                description: "Longitude",
                example: 101.5864,
              },
            },
            required: ["lat", "lng"],
          },
          Hospital: {
            type: "object",
            properties: {
              id: { type: "integer", description: "Hospital ID", example: 1 },
              name: {
                type: "string",
                description: "Hospital name",
                example: "Subang Jaya Medical Centre",
              },
              location: { $ref: "#/components/schemas/Location" },
              capabilities: {
                type: "array",
                items: { type: "string" },
                description: "Medical capabilities",
                example: ["PCI", "STROKE", "TRAUMA", "CT"],
              },
              ambulanceCount: {
                type: "integer",
                description: "Number of ambulances",
                example: 6,
              },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
          Ambulance: {
            type: "object",
            properties: {
              id: { type: "integer", description: "Ambulance ID", example: 1 },
              callsign: {
                type: "string",
                description: "Ambulance callsign",
                example: "SJM6-ALS-01",
              },
              type: {
                type: "string",
                enum: ["BLS", "ALS", "CCT", "RRV"],
                description: "Ambulance type",
              },
              status: {
                type: "string",
                enum: ["IDLE", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"],
                description: "Current status",
              },
              location: { $ref: "#/components/schemas/Location" },
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
          Incident: {
            type: "object",
            properties: {
              id: { type: "string", description: "Incident ID" },
              location: { $ref: "#/components/schemas/Location" },
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
                description: "Triage type",
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
          },
          Hazard: {
            type: "object",
            properties: {
              id: { type: "string", description: "Hazard ID" },
              type: {
                type: "string",
                enum: [
                  "FLOOD",
                  "ACCIDENT",
                  "ROADBLOCK",
                  "CONSTRUCTION",
                  "OTHER",
                ],
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
          },
          SuccessResponse: {
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              data: { type: "object" },
            },
          },
          ErrorResponse: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              error: { type: "string" },
            },
          },
        },
      },
    },
  });

  // Register Swagger UI
  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins for MVP
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Register WebSocket support
  await fastify.register(websocket);

  // Health check endpoint
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Health check",
        description: "Check if the API server is running",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", example: "ok" },
              timestamp: { type: "string", format: "date-time" },
              uptime: {
                type: "number",
                description: "Server uptime in seconds",
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    }
  );

  // API info endpoint
  fastify.get(
    "/",
    {
      schema: {
        tags: ["System"],
        summary: "API Information",
        description: "Get basic API information and available endpoints",
        response: {
          200: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              description: { type: "string" },
              documentation: { type: "string" },
              endpoints: { type: "object" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        name: "MySafeRoute API",
        version: "1.0.0",
        description: "Emergency Medical Services Routing System",
        documentation: "/docs",
        endpoints: {
          hospitals: "/hospitals",
          ambulances: "/ambulances",
          incidents: "/incidents",
          hazards: "/hazards",
          telemetry: "/ws/telemetry",
          health: "/health",
          docs: "/docs",
        },
      });
    }
  );

  // Register routes
  await fastify.register(hospitalRoutes);
  await fastify.register(ambulanceRoutes);
  await fastify.register(incidentRoutes);
  await fastify.register(hazardRoutes);
  await fastify.register(telemetryRoutes);
  await fastify.register(dispatchRoutes);
  await fastify.register(routingRoutes);

  return fastify;
}

/**
 * Start the server
 */
async function start() {
  try {
    const app = await buildApp();
    const port = parseInt(process.env.PORT || "3000", 10);

    // Verify database connection
    console.log("🔌 Connecting to database...");
    const hospitalCount = await prisma.hospital.count();
    const ambulanceCount = await prisma.ambulance.count();
    console.log(
      `✅ Database connected - ${hospitalCount} hospitals, ${ambulanceCount} ambulances`
    );

    // Start server
    await app.listen({ port, host: "0.0.0.0" });

    console.log(`
🚑 MySafeRoute Backend Server Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 HTTP:      http://localhost:${port}
📚 Swagger:   http://localhost:${port}/docs
📡 WebSocket: ws://localhost:${port}/ws/telemetry
🗄️  Database:  PostgreSQL (Neon)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the application
start();
