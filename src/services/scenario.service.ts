/**
 * Scenario Service
 *
 * Handles demo scenario creation:
 * - Mock AI analysis for incident classification
 * - User/Incident creation for God Mode triggers
 * - Broadcasts INCIDENT_ADDED via WebSocket
 */

import { prisma } from "../shared/store/prisma";
import { broadcastToDispatchers } from "../modules/telemetry/WebSocketService";

// ============ Types ============

// Use string literals until Prisma client is regenerated
export type IncidentCategory = "MEDICAL" | "FIRE" | "ACCIDENT" | "OTHER";
export type IncidentSeverity = "LOW" | "HIGH";
export type TriageType =
  | "STEMI"
  | "Stroke"
  | "Trauma"
  | "Burns"
  | "Pediatric"
  | "General";

export interface ScenarioRequest {
  lat: number;
  lng: number;
  description: string;
  callerName?: string;
  callerPhone?: string;
}

export interface ScenarioResult {
  success: boolean;
  incidentId?: string;
  userId?: number;
  category?: IncidentCategory;
  severity?: IncidentSeverity;
  triageType?: TriageType;
  message: string;
}

export interface AIAnalysisResult {
  category: IncidentCategory;
  severity: IncidentSeverity;
  triageType: TriageType;
  confidence: number;
  keywords: string[];
}

// ============ Constants ============

/** Keyword mappings for mock AI analysis */
const CATEGORY_KEYWORDS: Record<IncidentCategory, string[]> = {
  ACCIDENT: [
    "crash",
    "collision",
    "accident",
    "hit",
    "car",
    "vehicle",
    "motorcycle",
    "truck",
    "bus",
  ],
  FIRE: ["fire", "smoke", "burning", "flames", "explosion", "blaze"],
  MEDICAL: [
    "heart",
    "chest pain",
    "breathing",
    "unconscious",
    "fainted",
    "stroke",
    "seizure",
    "diabetic",
    "allergic",
    "choking",
    "bleeding",
    "injury",
    "hurt",
    "sick",
    "pain",
  ],
  OTHER: ["other", "unknown"],
};

const SEVERITY_KEYWORDS: Record<IncidentSeverity, string[]> = {
  HIGH: [
    "severe",
    "critical",
    "emergency",
    "dying",
    "unconscious",
    "not breathing",
    "heavy bleeding",
    "trapped",
    "multiple",
    "mass",
    "serious",
    "life-threatening",
  ],
  LOW: ["minor", "small", "slight", "stable", "conscious", "walking"],
};

const TRIAGE_KEYWORDS: Record<TriageType, string[]> = {
  STEMI: ["heart attack", "chest pain", "cardiac", "heart"],
  Stroke: [
    "stroke",
    "face drooping",
    "slurred speech",
    "numbness",
    "paralysis",
  ],
  Trauma: ["injury", "wound", "bleeding", "broken", "fracture", "cut", "crash"],
  Burns: ["burn", "fire", "scalded", "chemical burn"],
  Pediatric: ["child", "baby", "infant", "kid", "toddler", "pediatric"],
  General: [],
};

// ============ Service ============

class ScenarioService {
  /**
   * Analyze text description using keyword matching (Mock AI)
   */
  analyzeDescription(description: string): AIAnalysisResult {
    const lowerDesc = description.toLowerCase();
    const foundKeywords: string[] = [];

    // Determine category
    let category: IncidentCategory = "MEDICAL";
    let maxCategoryMatches = 0;

    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const matches = keywords.filter((kw) => lowerDesc.includes(kw));
      if (matches.length > maxCategoryMatches) {
        maxCategoryMatches = matches.length;
        category = cat as IncidentCategory;
        foundKeywords.push(...matches);
      }
    }

    // Determine severity
    let severity: IncidentSeverity = "LOW";
    const highMatches = SEVERITY_KEYWORDS.HIGH.filter((kw) =>
      lowerDesc.includes(kw)
    );
    if (highMatches.length > 0) {
      severity = "HIGH";
      foundKeywords.push(...highMatches);
    }

    // Determine triage type
    let triageType: TriageType = "General";
    for (const [triage, keywords] of Object.entries(TRIAGE_KEYWORDS)) {
      const matches = keywords.filter((kw) => lowerDesc.includes(kw));
      if (matches.length > 0) {
        triageType = triage as TriageType;
        foundKeywords.push(...matches);
        break;
      }
    }

    // Calculate mock confidence
    const confidence = Math.min(0.95, 0.5 + foundKeywords.length * 0.1);

    return {
      category,
      severity,
      triageType,
      confidence,
      keywords: [...new Set(foundKeywords)],
    };
  }

  /**
   * Create a demo scenario (God Mode)
   * Creates a User and Incident, broadcasts INCIDENT_ADDED
   */
  async createScenario(request: ScenarioRequest): Promise<ScenarioResult> {
    const { lat, lng, description, callerName, callerPhone } = request;

    console.log(`\n🎮 Creating Demo Scenario`);
    console.log(`   📍 Location: ${lat}, ${lng}`);
    console.log(`   📝 Description: ${description}`);

    // Step 1: Analyze description with mock AI
    const analysis = this.analyzeDescription(description);
    console.log(
      `   🤖 AI Analysis: ${analysis.category}, ${analysis.severity}`
    );

    // Step 2: Create user (caller/victim)
    const user = await prisma.user.create({
      data: {
        name: callerName || "Anonymous Caller",
        phone: callerPhone || null,
        lat,
        lng,
      },
    });

    console.log(`   👤 Created User: ${user.id} (${user.name})`);

    // Step 3: Create incident
    const incident = await prisma.incident.create({
      data: {
        lat,
        lng,
        description,
        category: analysis.category,
        severity: analysis.severity,
        triageType: analysis.triageType,
        isAiGenerated: true,
        status: "PENDING",
        reportedByUserId: user.id,
      },
    });

    console.log(`   🚨 Created Incident: ${incident.id}`);

    // Step 4: Broadcast INCIDENT_ADDED to all dispatchers
    broadcastToDispatchers({
      type: "INCIDENT_ADDED",
      incidentId: incident.id,
      lat: incident.lat,
      lng: incident.lng,
      category: incident.category,
      severity: incident.severity,
      triageType: incident.triageType,
      description: incident.description,
      timestamp: new Date().toISOString(),
    });

    console.log(`   📡 Broadcast INCIDENT_ADDED`);

    return {
      success: true,
      incidentId: incident.id,
      userId: user.id,
      category: analysis.category,
      severity: analysis.severity,
      triageType: analysis.triageType,
      message: `Scenario created: ${analysis.category} incident`,
    };
  }

  /**
   * Create multiple random incidents for demo seeding
   */
  async createRandomIncidents(
    count: number,
    centerLat: number,
    centerLng: number,
    radiusKm: number = 5
  ): Promise<ScenarioResult[]> {
    const scenarios = [
      { description: "Car crash on highway, multiple injuries" },
      { description: "Elderly person with chest pain, possible heart attack" },
      { description: "Child fell from playground, bleeding from head" },
      { description: "House fire with person trapped inside" },
      { description: "Motorcycle accident, rider unconscious" },
      { description: "Person choking at restaurant" },
      { description: "Stroke symptoms, face drooping" },
      { description: "Building collapse, multiple casualties" },
      { description: "Chemical burn at factory" },
      { description: "Diabetic emergency, person confused" },
    ];

    const results: ScenarioResult[] = [];

    for (let i = 0; i < count; i++) {
      // Random location within radius
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * radiusKm;
      const latOffset = (distance / 111) * Math.cos(angle);
      const lngOffset =
        (distance / (111 * Math.cos(centerLat * (Math.PI / 180)))) *
        Math.sin(angle);

      const scenario = scenarios[i % scenarios.length]!;
      const result = await this.createScenario({
        lat: centerLat + latOffset,
        lng: centerLng + lngOffset,
        description: scenario.description,
        callerName: `Caller ${i + 1}`,
      });

      results.push(result);

      // Small delay between creations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }
}

// Export singleton instance
export const scenarioService = new ScenarioService();
