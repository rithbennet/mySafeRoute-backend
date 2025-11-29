import type { FastifyInstance } from "fastify";
import {
  addDispatcherClient,
  removeDispatcherClient,
  addDispatchDashboardClient,
  removeDispatchDashboardClient,
  handleWSMessage,
} from "./WebSocketService";

/**
 * Telemetry WebSocket Routes
 */
export async function telemetryRoutes(fastify: FastifyInstance) {
  /**
   * WebSocket endpoint for real-time telemetry
   * - Dispatchers connect here to receive live updates
   * - Ambulances send GPS updates here
   */
  fastify.get("/ws/telemetry", { websocket: true }, (socket, _request) => {
    // Add client to dispatcher list
    addDispatcherClient(socket);

    // Handle incoming messages
    socket.on("message", (rawMessage: Buffer) => {
      handleWSMessage(socket, rawMessage.toString());
    });

    // Handle disconnect
    socket.on("close", () => {
      removeDispatcherClient(socket);
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error("WebSocket error:", error);
      removeDispatcherClient(socket);
    });

    // Send welcome message
    socket.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to MySafeRoute telemetry",
        timestamp: new Date().toISOString(),
      })
    );
  });

  /**
   * WebSocket endpoint for dispatch dashboard
   * Receives real-time updates about:
   * - AMBULANCE_UPDATE: Location and status changes
   * - HOSPITAL_SELECTED: When hospital is selected for transport
   * - SIMULATION_COMPLETE: When dispatch lifecycle completes
   * - SIMULATION_CANCELLED: When simulation is cancelled
   */
  fastify.get("/ws/dispatch", { websocket: true }, (socket, _request) => {
    // Add client to dispatch dashboard list
    addDispatchDashboardClient(socket);

    // Handle incoming messages (for future use - commands from dashboard)
    socket.on("message", (rawMessage: Buffer) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        console.log("📨 Dispatch dashboard message:", message);

        // Echo back for now
        socket.send(
          JSON.stringify({
            type: "ack",
            receivedType: message.type,
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        socket.send(JSON.stringify({ error: "Invalid message format" }));
      }
    });

    // Handle disconnect
    socket.on("close", () => {
      removeDispatchDashboardClient(socket);
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error("Dispatch WebSocket error:", error);
      removeDispatchDashboardClient(socket);
    });

    // Send welcome message
    socket.send(
      JSON.stringify({
        type: "connected",
        endpoint: "dispatch",
        message: "Connected to MySafeRoute dispatch dashboard",
        timestamp: new Date().toISOString(),
        messageTypes: [
          "AMBULANCE_UPDATE",
          "HOSPITAL_SELECTED",
          "SIMULATION_COMPLETE",
          "SIMULATION_CANCELLED",
        ],
      })
    );
  });
}
