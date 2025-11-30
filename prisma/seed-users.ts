/**
 * User/Victim Seeder
 *
 * Seeds mock users (potential victims) at specific Subang Jaya landmarks
 * These can be used for demo purposes or testing dispatch functionality
 */

import "dotenv/config";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ============ Mock Users at Subang Landmarks ============

interface MockUser {
  name: string;
  phone: string;
  lat: number;
  lng: number;
  landmark: string;
}

const MOCK_USERS: MockUser[] = [
  {
    name: "Ahmad bin Hassan",
    phone: "+60123456789",
    lat: 3.0733,
    lng: 101.6067,
    landmark: "Sunway Pyramid",
  },
  {
    name: "Siti Nurhaliza",
    phone: "+60198765432",
    lat: 3.0792,
    lng: 101.59,
    landmark: "SS15 Courtyard",
  },
  {
    name: "Raj Kumar",
    phone: "+60167891234",
    lat: 3.048,
    lng: 101.586,
    landmark: "USJ Taipan",
  },
  {
    name: "Tan Wei Lin",
    phone: "+60145678901",
    lat: 3.0569,
    lng: 101.5851,
    landmark: "SJMC Area",
  },
  {
    name: "Nurul Aisyah",
    phone: "+60112345678",
    lat: 3.0677,
    lng: 101.6043,
    landmark: "Sunway Medical Centre",
  },
];

// ============ Seed Function ============

async function seedUsers(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     👥 User/Victim Seeder - Subang Jaya Landmarks          ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n"
  );

  try {
    // Clear existing users
    console.log("🧹 Clearing existing users...");
    await prisma.user.deleteMany();
    console.log("✅ Users cleared\n");

    // Seed new users
    console.log("👥 Seeding mock users at Subang landmarks...\n");

    for (const user of MOCK_USERS) {
      const created = await prisma.user.create({
        data: {
          name: user.name,
          phone: user.phone,
          lat: user.lat,
          lng: user.lng,
        },
      });

      console.log(`   ✅ ${created.name}`);
      console.log(`      📍 ${user.landmark}`);
      console.log(`      📍 Coords: ${user.lat}, ${user.lng}`);
      console.log(`      📞 ${user.phone}\n`);
    }

    // Summary
    const userCount = await prisma.user.count();

    console.log(
      "╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                    🎉 Seeding Complete!                    ║"
    );
    console.log(
      "╠════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  👥 Users seeded: ${String(userCount).padStart(
        3
      )}                                    ║`
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n"
    );

    // Display all users
    console.log("📋 Seeded Users:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      "| ID | Name                | Location           | Phone        |"
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const users = await prisma.user.findMany();
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const landmark = MOCK_USERS[i]?.landmark ?? "Unknown";
      console.log(
        `| ${String(u.id).padEnd(2)} | ${u.name.padEnd(19)} | ${landmark.padEnd(
          18
        )} | ${(u.phone ?? "").padEnd(12)} |`
      );
    }
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    );
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  }
}

// ============ Entry Point ============

seedUsers()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
