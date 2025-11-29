import { z } from "zod";

// ============ Location Schema ============
export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type Location = z.infer<typeof LocationSchema>;

// ============ Hospital Schemas ============
export const HospitalCapabilitySchema = z.enum([
  "PCI", // Percutaneous Coronary Intervention (for STEMI)
  "CT", // CT Scan
  "Trauma", // Trauma Center
  "Neuro", // Neurology/Stroke Center
  "Burns", // Burns Unit
  "Pediatric", // Pediatric Emergency
  "General", // General Emergency
]);

export type HospitalCapability = z.infer<typeof HospitalCapabilitySchema>;

export const HospitalStatusSchema = z.enum(["OPEN", "DIVERTING", "CLOSED"]);

export type HospitalStatus = z.infer<typeof HospitalStatusSchema>;

export const HospitalSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: LocationSchema,
  capabilities: z.array(HospitalCapabilitySchema),
  status: HospitalStatusSchema,
  load: z.number().min(0).max(100), // 0-100 percentage
});

export type Hospital = z.infer<typeof HospitalSchema>;

export const UpdateHospitalStatusSchema = z.object({
  status: HospitalStatusSchema.optional(),
  load: z.number().min(0).max(100).optional(),
});

export type UpdateHospitalStatus = z.infer<typeof UpdateHospitalStatusSchema>;

// ============ Ambulance Schemas ============
export const AmbulanceStatusSchema = z.enum(["AVAILABLE", "BUSY", "OFFLINE"]);

export type AmbulanceStatus = z.infer<typeof AmbulanceStatusSchema>;

export const AmbulanceSchema = z.object({
  id: z.string(),
  callsign: z.string(),
  location: LocationSchema,
  status: AmbulanceStatusSchema,
});

export type Ambulance = z.infer<typeof AmbulanceSchema>;

// ============ Incident Schemas ============
export const TriageTypeSchema = z.enum([
  "STEMI", // Heart attack - needs PCI
  "Stroke", // Stroke - needs CT/Neuro
  "Trauma", // Major Trauma
  "Burns", // Burns
  "Pediatric", // Pediatric Emergency
  "General", // General Emergency
]);

export type TriageType = z.infer<typeof TriageTypeSchema>;

export const IncidentStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "TRANSPORTING",
  "COMPLETED",
  "CANCELLED",
]);

export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  location: LocationSchema,
  triage: TriageTypeSchema,
  status: IncidentStatusSchema,
  assignedAmbulanceId: z.string().nullable(),
  recommendedHospitalId: z.string().nullable(),
  route: z.any().nullable(), // GeoJSON
  etaSeconds: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Incident = z.infer<typeof IncidentSchema>;

export const CreateIncidentSchema = z.object({
  location: LocationSchema,
  triage: TriageTypeSchema,
});

export type CreateIncident = z.infer<typeof CreateIncidentSchema>;

export const AssignAmbulanceSchema = z.object({
  ambulanceId: z.string(),
});

export type AssignAmbulance = z.infer<typeof AssignAmbulanceSchema>;

// ============ Hazard Schemas ============
export const HazardTypeSchema = z.enum([
  "FLOOD",
  "ACCIDENT",
  "ROADBLOCK",
  "CONSTRUCTION",
  "OTHER",
]);

export type HazardType = z.infer<typeof HazardTypeSchema>;

export const HazardSchema = z.object({
  id: z.string(),
  type: HazardTypeSchema,
  description: z.string(),
  // Simplified bounding box for MVP
  bounds: z.object({
    minLat: z.number(),
    maxLat: z.number(),
    minLng: z.number(),
    maxLng: z.number(),
  }),
  active: z.boolean(),
  createdAt: z.date(),
});

export type Hazard = z.infer<typeof HazardSchema>;

export const CreateHazardSchema = z.object({
  type: HazardTypeSchema,
  description: z.string(),
  bounds: z.object({
    minLat: z.number(),
    maxLat: z.number(),
    minLng: z.number(),
    maxLng: z.number(),
  }),
});

export type CreateHazard = z.infer<typeof CreateHazardSchema>;

// ============ Routing Schemas ============
export const RouteResultSchema = z.object({
  geometry: z.any(), // GeoJSON LineString
  etaSeconds: z.number(),
  distanceMeters: z.number(),
});

export type RouteResult = z.infer<typeof RouteResultSchema>;

// ============ WebSocket Message Schemas ============
export const WSMessageTypeSchema = z.enum([
  "gps_update",
  "incident_update",
  "ambulance_update",
  "reroute_alert",
]);

export const GPSUpdateSchema = z.object({
  type: z.literal("gps_update"),
  ambulanceId: z.string(),
  location: LocationSchema,
});

export type GPSUpdate = z.infer<typeof GPSUpdateSchema>;

export const WSIncomingMessageSchema = z.discriminatedUnion("type", [
  GPSUpdateSchema,
]);

export type WSIncomingMessage = z.infer<typeof WSIncomingMessageSchema>;

// ============ Hospital Scoring ============
export const HospitalScoreSchema = z.object({
  hospital: HospitalSchema,
  score: z.number(),
  etaSeconds: z.number(),
  distanceMeters: z.number(),
  route: z.any().nullable(),
});

export type HospitalScore = z.infer<typeof HospitalScoreSchema>;
