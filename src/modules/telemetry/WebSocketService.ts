import type { WebSocket } from "@fastify/websocket";
import db from "../../shared/store/Database";
import { GPSUpdateSchema } from "../../shared/types";

// Store connected dispatcher clients
const dispatcherClients: Set<WebSocket> = new Set();

/**
 * Add a dispatcher client
 */
export function addDispatcherClient(socket: WebSocket): void {
  dispatcherClients.add(socket);
  console.log(`📡 Dispatcher connected. Total: ${dispatcherClients.size}`);
}

/**
 * Remove a dispatcher client
 */
export function removeDispatcherClient(socket: WebSocket): void {
  dispatcherClients.delete(socket);
  console.log(`📡 Dispatcher disconnected. Total: ${dispatcherClients.size}`);
}

/**
 * Broadcast message to all dispatchers
 */
export function broadcastToDispatchers(data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of dispatcherClients) {
    if (client.readyState === 1) {
      // OPEN state
      client.send(message);
    }
  }
}

/**
 * Handle incoming WebSocket message
 */
export function handleWSMessage(socket: WebSocket, rawMessage: string): void {
  try {
    const message = JSON.parse(rawMessage);

    // Handle GPS update from ambulance
    if (message.type === "gps_update") {
      const parseResult = GPSUpdateSchema.safeParse(message);
      if (!parseResult.success) {
        socket.send(JSON.stringify({ error: "Invalid GPS update format" }));
        return;
      }

      const { ambulanceId, location } = parseResult.data;

      // Update ambulance location in database
      const ambulance = db.getAmbulance(ambulanceId);
      if (ambulance) {
        db.updateAmbulance(ambulanceId, { location });

        // Broadcast to all dispatchers
        broadcastToDispatchers({
          type: "ambulance_location",
          ambulanceId,
          location,
          timestamp: new Date().toISOString(),
        });
      } else {
        socket.send(JSON.stringify({ error: "Ambulance not found" }));
      }
    }
  } catch (error) {
    console.error("WebSocket message error:", error);
    socket.send(JSON.stringify({ error: "Invalid message format" }));
  }
}

/**
 * Get connected dispatcher count
 */
export function getDispatcherCount(): number {
  return dispatcherClients.size;
}
