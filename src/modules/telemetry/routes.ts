import type { FastifyInstance } from "fastify";
import {
  addDispatcherClient,
  removeDispatcherClient,
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
}
