import "dotenv/config";
import pg from "pg";
import {
  PrismaClient,
  IncidentCategory,
  IncidentSeverity,
  TriageType,
  IncidentStatus,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Mock incidents concentrated around Subang Jaya / Sunway area
 * Creates 10 demo incidents with varied categories/severity/triage types
 */

const MOCK_INCIDENTS = [
  {
    lat: 3.0677,
    lng: 101.6043,
    category: IncidentCategory.MEDICAL,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.STEMI,
    description: "Chest pain, sweating, collapsed in mall parking",
    dispatcherNotes: "Priority - possible STEMI",
  },
  {
    lat: 3.0733,
    lng: 101.6067,
    category: IncidentCategory.ACCIDENT,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.Trauma,
    description: "Multi-vehicle collision on main road",
    dispatcherNotes: "Multiple casualties reported",
  },
  {
    lat: 3.0569,
    lng: 101.5851,
    category: IncidentCategory.MEDICAL,
    severity: IncidentSeverity.LOW,
    triageType: TriageType.General,
    description: "Elderly person fainted at residential block",
    dispatcherNotes: null,
  },
  {
    lat: 3.0792,
    lng: 101.59,
    category: IncidentCategory.OTHER,
    severity: IncidentSeverity.LOW,
    triageType: TriageType.General,
    description: "Person with minor lacerations after fall",
    dispatcherNotes: "Non-critical",
  },
  {
    lat: 3.048,
    lng: 101.586,
    category: IncidentCategory.ACCIDENT,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.Trauma,
    description: "Motorcycle vs car, rider unconscious",
    dispatcherNotes: "Helmet removed, airway check needed",
  },
  {
    lat: 3.0244,
    lng: 101.6172,
    category: IncidentCategory.MEDICAL,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.Stroke,
    description: "Suspected stroke, slurred speech and weakness",
    dispatcherNotes: "FAST positive",
  },
  {
    lat: 3.1117,
    lng: 101.5811,
    category: IncidentCategory.FIRE,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.General,
    description: "Small shop fire, smoke inhalation",
    dispatcherNotes: "Fire brigade notified",
  },
  {
    lat: 3.1323,
    lng: 101.6178,
    category: IncidentCategory.OTHER,
    severity: IncidentSeverity.LOW,
    triageType: TriageType.General,
    description: "Person reporting dizziness - possible dehydration",
    dispatcherNotes: null,
  },
  {
    lat: 3.0757,
    lng: 101.5864,
    category: IncidentCategory.MEDICAL,
    severity: IncidentSeverity.LOW,
    triageType: TriageType.Pediatric,
    description: "Child with high fever at playground",
    dispatcherNotes: "Parent on scene",
  },
  {
    lat: 3.067,
    lng: 101.595,
    category: IncidentCategory.ACCIDENT,
    severity: IncidentSeverity.HIGH,
    triageType: TriageType.Trauma,
    description: "Construction site collapse, trapped worker",
    dispatcherNotes: "Special rescue may be required",
  },
];

async function seedIncidents(): Promise<void> {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     🚨 Mock Incident Seeder (10)       ║");
  console.log("╚════════════════════════════════════════╝\n");

  try {
    console.log("🧹 Clearing existing incidents...");
    await prisma.incident.deleteMany();
    console.log("✅ Incidents cleared\n");

    // Attempt to fetch available hospitals and users to associate
    const hospitals = await prisma.hospital.findMany();
    const users = await prisma.user.findMany();

    console.log(
      `ℹ️  Found ${hospitals.length} hospitals, ${users.length} users to optionally link`
    );

    let createdCount = 0;

    for (const [i, src] of MOCK_INCIDENTS.entries()) {
      // pick a hospital/user deterministically if available
      const hospital = hospitals.length
        ? hospitals[i % hospitals.length]
        : null;
      const user = users.length ? users[i % users.length] : null;

      const data: any = {
        lat: src.lat,
        lng: src.lng,
        severity: src.severity,
        triageType: src.triageType,
        status: IncidentStatus.PENDING,
        category: src.category,
        description: src.description,
        isAiGenerated: false,
        dispatcherNotes: src.dispatcherNotes ?? null,
        destinationHospitalId: hospital ? hospital.id : null,
        reportedByUserId: user ? user.id : null,
      };

      const created = await prisma.incident.create({ data });

      console.log(
        `   ✅ Created incident ${created.id} - ${String(
          created.category
        )} @ ${created.lat.toFixed(5)},${created.lng.toFixed(5)}`
      );
      createdCount++;
    }

    console.log(`\n🎉 Created ${createdCount} mock incidents`);

    const total = await prisma.incident.count();
    console.log(`Database now has ${total} incidents`);
  } catch (error) {
    console.error("❌ Seeding incidents failed:", error);
    throw error;
  }
}

seedIncidents()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
