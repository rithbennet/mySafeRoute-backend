import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

// Import modules
import { hospitalRoutes } from "./modules/hospitals";
import { ambulanceRoutes } from "./modules/ambulances";
import { incidentRoutes } from "./modules/incidents";
import { hazardRoutes } from "./modules/hazards";
import { telemetryRoutes } from "./modules/telemetry";
import { routingRoutes } from "./modules/routing";

// Import seed data
import { seedAll } from "./shared/seed";

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

  // Register CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins for MVP
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Register WebSocket support
  await fastify.register(websocket);

  // Health check endpoint
  fastify.get("/health", async (_request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API info endpoint
  fastify.get("/", async (_request, reply) => {
    return reply.send({
      name: "MySafeRoute API",
      version: "1.0.0",
      description: "Emergency Medical Services Routing System",
      endpoints: {
        hospitals: "/hospitals",
        ambulances: "/ambulances",
        incidents: "/incidents",
        hazards: "/hazards",
        telemetry: "/ws/telemetry",
        health: "/health",
      },
    });
  });

  // Register routes
  await fastify.register(hospitalRoutes);
  await fastify.register(ambulanceRoutes);
  await fastify.register(incidentRoutes);
  await fastify.register(hazardRoutes);
  await fastify.register(telemetryRoutes);
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

    // Seed initial data
    seedAll();

    // Start server
    await app.listen({ port, host: "0.0.0.0" });

    console.log(`
🚑 MySafeRoute Backend Server Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 HTTP:      http://localhost:${port}
📡 WebSocket: ws://localhost:${port}/ws/telemetry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Available Endpoints:
  GET  /                    - API Info
  GET  /health              - Health Check
  
  GET  /hospitals           - List all hospitals
  GET  /hospitals/:id       - Get hospital details
  POST /hospitals/:id/status - Update hospital status
  
  GET  /ambulances          - List all ambulances
  GET  /ambulances/available - List available ambulances
  GET  /ambulances/:id      - Get ambulance details
  
  GET  /incidents           - List all incidents
  GET  /incidents/active    - List active incidents
  GET  /incidents/:id       - Get incident details
  POST /incidents           - Create new incident
  POST /incidents/:id/assign - Assign ambulance
  
  GET  /hazards             - List all hazards
  GET  /hazards/active      - List active hazards
  POST /hazards             - Create hazard
  
  WS   /ws/telemetry        - Real-time telemetry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the application
start();
