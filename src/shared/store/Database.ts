import type { Hospital, Incident, Ambulance, Hazard } from "../types";

/**
 * In-Memory Database Singleton
 * Stores all application data in memory for MVP
 */
class Database {
  private static instance: Database;

  // Data stores
  private hospitals: Map<string, Hospital> = new Map();
  private incidents: Map<string, Incident> = new Map();
  private ambulances: Map<string, Ambulance> = new Map();
  private hazards: Map<string, Hazard> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  // ============ Hospital Methods ============
  public getHospitals(): Hospital[] {
    return Array.from(this.hospitals.values());
  }

  public getHospital(id: string): Hospital | undefined {
    return this.hospitals.get(id);
  }

  public setHospital(hospital: Hospital): void {
    this.hospitals.set(hospital.id, hospital);
  }

  public updateHospital(
    id: string,
    updates: Partial<Hospital>
  ): Hospital | undefined {
    const hospital = this.hospitals.get(id);
    if (!hospital) return undefined;
    const updated = { ...hospital, ...updates };
    this.hospitals.set(id, updated);
    return updated;
  }

  // ============ Incident Methods ============
  public getIncidents(): Incident[] {
    return Array.from(this.incidents.values());
  }

  public getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  public setIncident(incident: Incident): void {
    this.incidents.set(incident.id, incident);
  }

  public updateIncident(
    id: string,
    updates: Partial<Incident>
  ): Incident | undefined {
    const incident = this.incidents.get(id);
    if (!incident) return undefined;
    const updated = { ...incident, ...updates, updatedAt: new Date() };
    this.incidents.set(id, updated);
    return updated;
  }

  public getActiveIncidents(): Incident[] {
    return this.getIncidents().filter(
      (i) => !["COMPLETED", "CANCELLED"].includes(i.status)
    );
  }

  // ============ Ambulance Methods ============
  public getAmbulances(): Ambulance[] {
    return Array.from(this.ambulances.values());
  }

  public getAmbulance(id: string): Ambulance | undefined {
    return this.ambulances.get(id);
  }

  public setAmbulance(ambulance: Ambulance): void {
    this.ambulances.set(ambulance.id, ambulance);
  }

  public updateAmbulance(
    id: string,
    updates: Partial<Ambulance>
  ): Ambulance | undefined {
    const ambulance = this.ambulances.get(id);
    if (!ambulance) return undefined;
    const updated = { ...ambulance, ...updates };
    this.ambulances.set(id, updated);
    return updated;
  }

  public getAvailableAmbulances(): Ambulance[] {
    return this.getAmbulances().filter((a) => a.status === "AVAILABLE");
  }

  // ============ Hazard Methods ============
  public getHazards(): Hazard[] {
    return Array.from(this.hazards.values());
  }

  public getActiveHazards(): Hazard[] {
    return this.getHazards().filter((h) => h.active);
  }

  public getHazard(id: string): Hazard | undefined {
    return this.hazards.get(id);
  }

  public setHazard(hazard: Hazard): void {
    this.hazards.set(hazard.id, hazard);
  }

  public updateHazard(
    id: string,
    updates: Partial<Hazard>
  ): Hazard | undefined {
    const hazard = this.hazards.get(id);
    if (!hazard) return undefined;
    const updated = { ...hazard, ...updates };
    this.hazards.set(id, updated);
    return updated;
  }

  public deleteHazard(id: string): boolean {
    return this.hazards.delete(id);
  }

  // ============ Utility Methods ============
  public clearAll(): void {
    this.hospitals.clear();
    this.incidents.clear();
    this.ambulances.clear();
    this.hazards.clear();
  }
}

export const db = Database.getInstance();
export default db;
