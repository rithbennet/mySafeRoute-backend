/**
 * Shared Prisma Client Instance
 * Singleton pattern for database connection
 */

import "dotenv/config";
import pg from "pg";
import { PrismaClient } from "../../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Create connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Create and export Prisma client instance
export const prisma = new PrismaClient({ adapter });

// Re-export types and enums from Prisma
export {
  AmbulanceType,
  AmbulanceStatus,
} from "../../../generated/prisma/client";

export type { Hospital, Ambulance } from "../../../generated/prisma/client";

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
  await pool.end();
});
