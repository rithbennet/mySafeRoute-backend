/**
 * Hybrid Seeding Script for Emergency Dispatch System
 *
 * Strategy:
 * 1. Scrape real hospital locations from OpenStreetMap (Overpass API)
 * 2. Enrich with "Known Truth" intelligence for major hospitals
 * 3. Apply heuristic fallback for unknown facilities
 *
 * Focus Area: Subang Jaya, Malaysia
 */

import "dotenv/config";
import axios from "axios";
import pg from "pg";
import {
  PrismaClient,
  AmbulanceType,
  AmbulanceStatus,
} from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ============ Configuration ============

const SUBANG_JAYA_CONFIG = {
  center: { lat: 3.0757, lng: 101.5864 },
  radiusMeters: 8000,
};

// ============ Types ============

interface FleetConfig {
  type: AmbulanceType;
  count: number;
}

interface HospitalIntelligence {
  capabilities: string[];
  fleet: FleetConfig[];
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: {
    name?: string;
    "name:en"?: string;
    amenity?: string;
    healthcare?: string;
  };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// ============ Intelligence Dictionary ============
// Real-world knowledge about major hospitals in Subang Jaya

const HOSPITAL_INTELLIGENCE: Record<string, HospitalIntelligence> = {
  // Subang Jaya Medical Centre (SJMC) - Premier private hospital
  "subang jaya medical centre": {
    capabilities: ["PCI", "STROKE", "TRAUMA", "CT", "NEURO"],
    fleet: [
      { type: AmbulanceType.CCT, count: 1 },
      { type: AmbulanceType.ALS, count: 3 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },
  sjmc: {
    capabilities: ["PCI", "STROKE", "TRAUMA", "CT", "NEURO"],
    fleet: [
      { type: AmbulanceType.CCT, count: 1 },
      { type: AmbulanceType.ALS, count: 3 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },

  // Sunway Medical Centre - Major private hospital
  "sunway medical centre": {
    capabilities: ["PCI", "TRAUMA", "BURNS", "CT", "NEURO", "PEDIATRIC"],
    fleet: [
      { type: AmbulanceType.CCT, count: 1 },
      { type: AmbulanceType.ALS, count: 4 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },
  "sunway medical": {
    capabilities: ["PCI", "TRAUMA", "BURNS", "CT", "NEURO", "PEDIATRIC"],
    fleet: [
      { type: AmbulanceType.CCT, count: 1 },
      { type: AmbulanceType.ALS, count: 4 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },

  // Hospital Shah Alam - Public hospital
  "hospital shah alam": {
    capabilities: ["CT", "TRAUMA", "GENERAL"],
    fleet: [
      { type: AmbulanceType.ALS, count: 3 },
      { type: AmbulanceType.BLS, count: 3 },
    ],
  },

  // Columbia Asia Hospital - Mid-tier private
  "columbia asia": {
    capabilities: ["CT", "TRAUMA", "GENERAL"],
    fleet: [
      { type: AmbulanceType.ALS, count: 2 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },

  // Ara Damansara Medical Centre
  "ara damansara medical centre": {
    capabilities: ["CT", "TRAUMA", "GENERAL"],
    fleet: [
      { type: AmbulanceType.ALS, count: 2 },
      { type: AmbulanceType.BLS, count: 1 },
    ],
  },

  // KPJ Damansara Specialist Hospital
  "kpj damansara": {
    capabilities: ["CT", "TRAUMA", "PCI"],
    fleet: [
      { type: AmbulanceType.ALS, count: 2 },
      { type: AmbulanceType.BLS, count: 2 },
    ],
  },

  // Sime Darby Medical Centre
  "sime darby medical": {
    capabilities: ["CT", "TRAUMA", "GENERAL"],
    fleet: [
      { type: AmbulanceType.ALS, count: 2 },
      { type: AmbulanceType.BLS, count: 1 },
    ],
  },
};

// Default fleet for unknown hospitals
const DEFAULT_FLEET: FleetConfig[] = [
  { type: AmbulanceType.ALS, count: 1 },
  { type: AmbulanceType.BLS, count: 1 },
];

const DEFAULT_CAPABILITIES = ["GENERAL", "CT"];

// ============ Overpass API Query ============

function buildOverpassQuery(lat: number, lng: number, radius: number): string {
  return `
    [out:json][timeout:30];
    (
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      way["amenity"="hospital"](around:${radius},${lat},${lng});
      relation["amenity"="hospital"](around:${radius},${lat},${lng});
    );
    out center;
  `;
}

async function fetchHospitalsFromOSM(): Promise<OverpassElement[]> {
  const { lat, lng } = SUBANG_JAYA_CONFIG.center;
  const query = buildOverpassQuery(lat, lng, SUBANG_JAYA_CONFIG.radiusMeters);

  console.log("🔍 Querying OpenStreetMap Overpass API...");
  console.log(`   Center: ${lat}, ${lng}`);
  console.log(`   Radius: ${SUBANG_JAYA_CONFIG.radiusMeters}m`);

  try {
    const response = await axios.post<OverpassResponse>(
      "https://overpass-api.de/api/interpreter",
      `data=${encodeURIComponent(query)}`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 60000,
      }
    );

    console.log(
      `✅ Found ${response.data.elements.length} raw results from OSM`
    );
    return response.data.elements;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ Overpass API error:", error.message);
      if (error.response) {
        console.error("   Status:", error.response.status);
      }
    } else {
      console.error("❌ Unexpected error:", error);
    }
    throw error;
  }
}

// ============ Filtering Logic ============

const EXCLUDED_KEYWORDS = [
  "clinic",
  "klinik",
  "dental",
  "veterinary",
  "vet",
  "animal",
  "pergigian",
  "haiwan",
  "pharmacy",
  "farmasi",
];

const VALID_KEYWORDS = [
  "hospital",
  "centre",
  "center",
  "medical",
  "pusat perubatan",
];

function isValidHospital(element: OverpassElement): boolean {
  const name = (
    element.tags?.name ||
    element.tags?.["name:en"] ||
    ""
  ).toLowerCase();

  // Skip if no name
  if (!name) {
    return false;
  }

  // Exclude clinics, dental, veterinary, etc.
  if (EXCLUDED_KEYWORDS.some((keyword) => name.includes(keyword))) {
    return false;
  }

  // Must contain valid hospital keywords
  return VALID_KEYWORDS.some((keyword) => name.includes(keyword));
}

function extractCoordinates(
  element: OverpassElement
): { lat: number; lng: number } | null {
  // For nodes, coordinates are directly available
  if (element.lat !== undefined && element.lon !== undefined) {
    return { lat: element.lat, lng: element.lon };
  }

  // For ways/relations, use center point
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }

  return null;
}

// ============ Intelligence Matching ============

function matchIntelligence(name: string): HospitalIntelligence | null {
  const normalizedName = name.toLowerCase();

  for (const [key, intel] of Object.entries(HOSPITAL_INTELLIGENCE)) {
    if (normalizedName.includes(key)) {
      return intel;
    }
  }

  return null;
}

function generateCallsign(
  hospitalName: string,
  hospitalId: number,
  type: AmbulanceType,
  index: number
): string {
  // Create acronym from hospital name
  const words = hospitalName.split(/\s+/).filter((w) => w.length > 2);
  const acronym = words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

  // Include hospital ID to ensure uniqueness across hospitals with similar names
  return `${acronym || "AMB"}${hospitalId}-${type}-${String(index).padStart(
    2,
    "0"
  )}`;
}

// ============ Database Operations ============

async function clearDatabase(): Promise<void> {
  console.log("🧹 Clearing existing data...");

  // Delete in order due to foreign key constraints
  await prisma.ambulance.deleteMany();
  await prisma.hospital.deleteMany();

  console.log("✅ Database cleared");
}

async function seedHospital(
  name: string,
  lat: number,
  lng: number,
  capabilities: string[],
  fleet: FleetConfig[]
): Promise<void> {
  console.log(`\n🏥 Seeding: ${name}`);
  console.log(`   📍 Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  console.log(`   🏷️  Capabilities: ${capabilities.join(", ")}`);

  // Create hospital
  const hospital = await prisma.hospital.create({
    data: {
      name,
      lat,
      lng,
      capabilities,
    },
  });

  // Create ambulances
  let ambulanceCount = 0;
  for (const { type, count } of fleet) {
    for (let i = 1; i <= count; i++) {
      const callsign = generateCallsign(
        name,
        hospital.id,
        type,
        ambulanceCount + 1
      );

      // Position ambulances near the hospital with slight random offset
      const offsetLat = (Math.random() - 0.5) * 0.002; // ~100m variance
      const offsetLng = (Math.random() - 0.5) * 0.002;

      await prisma.ambulance.create({
        data: {
          callsign,
          type,
          status: AmbulanceStatus.IDLE,
          currentLat: lat + offsetLat,
          currentLng: lng + offsetLng,
          hospitalId: hospital.id,
        },
      });

      ambulanceCount++;
    }
  }

  console.log(`   🚑 Created ${ambulanceCount} ambulances`);
}

// ============ Main Seed Function ============

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     🏥 Emergency Dispatch System - Hybrid Seeder 🚑       ║");
  console.log("║              Focus: Subang Jaya, Malaysia                  ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n"
  );

  try {
    // Step 1: Clear existing data
    await clearDatabase();

    // Step 2: Fetch hospitals from OpenStreetMap
    const osmElements = await fetchHospitalsFromOSM();

    // Step 3: Filter and process hospitals
    const validHospitals = osmElements.filter(isValidHospital);
    console.log(
      `\n✅ ${validHospitals.length} valid hospitals after filtering`
    );

    if (validHospitals.length === 0) {
      console.log("\n⚠️  No hospitals found from OSM. Using fallback data...");
      await seedFallbackHospitals();
    } else {
      // Step 4: Seed each hospital with intelligence enrichment
      for (const element of validHospitals) {
        const name =
          element.tags?.name || element.tags?.["name:en"] || "Unknown Hospital";
        const coords = extractCoordinates(element);

        if (!coords) {
          console.log(`⚠️  Skipping ${name} - no coordinates`);
          continue;
        }

        // Match against intelligence dictionary
        const intel = matchIntelligence(name);

        if (intel) {
          console.log(`   🎯 Matched intelligence profile`);
          await seedHospital(
            name,
            coords.lat,
            coords.lng,
            intel.capabilities,
            intel.fleet
          );
        } else {
          console.log(`   📋 Using default profile`);
          await seedHospital(
            name,
            coords.lat,
            coords.lng,
            DEFAULT_CAPABILITIES,
            DEFAULT_FLEET
          );
        }
      }
    }

    // Step 5: Summary
    const hospitalCount = await prisma.hospital.count();
    const ambulanceCount = await prisma.ambulance.count();

    console.log(
      "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                    🎉 Seeding Complete!                    ║"
    );
    console.log(
      "╠════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  🏥 Hospitals:  ${String(hospitalCount).padStart(
        3
      )}                                      ║`
    );
    console.log(
      `║  🚑 Ambulances: ${String(ambulanceCount).padStart(
        3
      )}                                      ║`
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n"
    );
  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    throw error;
  }
}

// ============ Fallback Data ============
// Used when OSM API is unavailable

async function seedFallbackHospitals(): Promise<void> {
  console.log("\n📦 Using hardcoded fallback hospital data...\n");

  const fallbackHospitals = [
    {
      name: "Subang Jaya Medical Centre (SJMC)",
      lat: 3.0569,
      lng: 101.5851,
      capabilities: ["PCI", "STROKE", "TRAUMA", "CT", "NEURO"],
      fleet: [
        { type: AmbulanceType.CCT, count: 1 },
        { type: AmbulanceType.ALS, count: 3 },
        { type: AmbulanceType.BLS, count: 2 },
      ],
    },
    {
      name: "Sunway Medical Centre",
      lat: 3.0677,
      lng: 101.6043,
      capabilities: ["PCI", "TRAUMA", "BURNS", "CT", "NEURO", "PEDIATRIC"],
      fleet: [
        { type: AmbulanceType.CCT, count: 1 },
        { type: AmbulanceType.ALS, count: 4 },
        { type: AmbulanceType.BLS, count: 2 },
      ],
    },
    {
      name: "Hospital Shah Alam",
      lat: 3.0733,
      lng: 101.5185,
      capabilities: ["CT", "TRAUMA", "GENERAL"],
      fleet: [
        { type: AmbulanceType.ALS, count: 3 },
        { type: AmbulanceType.BLS, count: 3 },
      ],
    },
    {
      name: "Columbia Asia Hospital - Puchong",
      lat: 3.0244,
      lng: 101.6172,
      capabilities: ["CT", "TRAUMA", "GENERAL"],
      fleet: [
        { type: AmbulanceType.ALS, count: 2 },
        { type: AmbulanceType.BLS, count: 2 },
      ],
    },
    {
      name: "Ara Damansara Medical Centre",
      lat: 3.1117,
      lng: 101.5811,
      capabilities: ["CT", "TRAUMA", "GENERAL"],
      fleet: [
        { type: AmbulanceType.ALS, count: 2 },
        { type: AmbulanceType.BLS, count: 1 },
      ],
    },
    {
      name: "KPJ Damansara Specialist Hospital",
      lat: 3.1323,
      lng: 101.6178,
      capabilities: ["CT", "TRAUMA", "PCI"],
      fleet: [
        { type: AmbulanceType.ALS, count: 2 },
        { type: AmbulanceType.BLS, count: 2 },
      ],
    },
  ];

  for (const hospital of fallbackHospitals) {
    await seedHospital(
      hospital.name,
      hospital.lat,
      hospital.lng,
      hospital.capabilities,
      hospital.fleet
    );
  }
}

// ============ Entry Point ============

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
