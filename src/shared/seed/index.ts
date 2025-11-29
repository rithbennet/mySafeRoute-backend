import db from "../store/Database";
import type { Hospital, Ambulance } from "../types";

/**
 * Seed Klang Valley Hospital Data
 * Real hospitals with accurate coordinates and capabilities
 */
export function seedHospitals(): void {
  const hospitals: Hospital[] = [
    {
      id: "hkl",
      name: "Hospital Kuala Lumpur (HKL)",
      location: { lat: 3.1714, lng: 101.7006 },
      capabilities: [
        "PCI",
        "CT",
        "Trauma",
        "Neuro",
        "Burns",
        "Pediatric",
        "General",
      ],
      status: "OPEN",
      load: 65,
    },
    {
      id: "ummc",
      name: "University Malaya Medical Centre (UMMC)",
      location: { lat: 3.1131, lng: 101.6557 },
      capabilities: ["PCI", "CT", "Trauma", "Neuro", "Pediatric", "General"],
      status: "OPEN",
      load: 70,
    },
    {
      id: "ijn",
      name: "Institut Jantung Negara (IJN)",
      location: { lat: 3.1656, lng: 101.6996 },
      capabilities: ["PCI", "CT", "General"],
      status: "OPEN",
      load: 55,
    },
    {
      id: "serdang",
      name: "Hospital Serdang",
      location: { lat: 3.0231, lng: 101.7175 },
      capabilities: ["CT", "Trauma", "Neuro", "Pediatric", "General"],
      status: "OPEN",
      load: 45,
    },
    {
      id: "selayang",
      name: "Hospital Selayang",
      location: { lat: 3.2567, lng: 101.6367 },
      capabilities: ["CT", "Trauma", "Neuro", "General"],
      status: "OPEN",
      load: 50,
    },
    {
      id: "ampang",
      name: "Hospital Ampang",
      location: { lat: 3.1506, lng: 101.7644 },
      capabilities: ["CT", "Trauma", "Pediatric", "General"],
      status: "OPEN",
      load: 40,
    },
    {
      id: "kajang",
      name: "Hospital Kajang",
      location: { lat: 2.9928, lng: 101.7878 },
      capabilities: ["CT", "Trauma", "General"],
      status: "OPEN",
      load: 35,
    },
    {
      id: "putrajaya",
      name: "Hospital Putrajaya",
      location: { lat: 2.9333, lng: 101.6833 },
      capabilities: [
        "PCI",
        "CT",
        "Trauma",
        "Neuro",
        "Burns",
        "Pediatric",
        "General",
      ],
      status: "OPEN",
      load: 30,
    },
    {
      id: "klang",
      name: "Hospital Tengku Ampuan Rahimah Klang",
      location: { lat: 3.0441, lng: 101.4456 },
      capabilities: ["CT", "Trauma", "Neuro", "General"],
      status: "OPEN",
      load: 60,
    },
    {
      id: "sg-buloh",
      name: "Hospital Sungai Buloh",
      location: { lat: 3.2167, lng: 101.5833 },
      capabilities: ["CT", "Trauma", "General"],
      status: "OPEN",
      load: 55,
    },
  ];

  hospitals.forEach((hospital) => db.setHospital(hospital));
  console.log(`✅ Seeded ${hospitals.length} hospitals`);
}

/**
 * Seed Mock Ambulance Data
 */
export function seedAmbulances(): void {
  const ambulances: Ambulance[] = [
    {
      id: "amb-001",
      callsign: "ALPHA-1",
      location: { lat: 3.1209, lng: 101.6538 }, // Petaling Jaya
      status: "AVAILABLE",
    },
    {
      id: "amb-002",
      callsign: "BRAVO-2",
      location: { lat: 3.1579, lng: 101.7119 }, // KLCC area
      status: "AVAILABLE",
    },
    {
      id: "amb-003",
      callsign: "CHARLIE-3",
      location: { lat: 3.08, lng: 101.585 }, // Subang Jaya
      status: "AVAILABLE",
    },
  ];

  ambulances.forEach((ambulance) => db.setAmbulance(ambulance));
  console.log(`✅ Seeded ${ambulances.length} ambulances`);
}

/**
 * Run all seed functions
 */
export function seedAll(): void {
  console.log("🌱 Seeding database...");
  seedHospitals();
  seedAmbulances();
  console.log("🌱 Database seeding complete!");
}
