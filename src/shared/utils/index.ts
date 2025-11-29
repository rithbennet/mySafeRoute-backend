import { randomUUID } from "crypto";

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Map triage type to required hospital capabilities
 */
export function getRequiredCapabilities(triage: string): string[] {
  const mapping: Record<string, string[]> = {
    STEMI: ["PCI"],
    Stroke: ["CT", "Neuro"],
    Trauma: ["Trauma"],
    Burns: ["Burns"],
    Pediatric: ["Pediatric"],
    General: ["General"],
  };
  return mapping[triage] || ["General"];
}

/**
 * Check if a point is within a bounding box
 */
export function isPointInBounds(
  lat: number,
  lng: number,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): boolean {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

/**
 * Check if a route (array of coordinates) intersects with bounds
 */
export function routeIntersectsBounds(
  coordinates: [number, number][],
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): boolean {
  // Coordinates are [lng, lat] in GeoJSON
  for (const [lng, lat] of coordinates) {
    if (isPointInBounds(lat, lng, bounds)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a value to 0-1 range
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}
