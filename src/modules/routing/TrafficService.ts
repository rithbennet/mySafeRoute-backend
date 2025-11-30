import type { Location } from "../../shared/types";

/**
 * Traffic Flow Data from TomTom
 */
export interface TrafficFlowData {
  currentSpeed: number; // km/h
  freeFlowSpeed: number; // km/h
  currentTravelTime: number; // seconds
  freeFlowTravelTime: number; // seconds
  confidence: number; // 0-1
  roadClosure: boolean;
  congestionLevel: "free" | "light" | "moderate" | "heavy" | "severe";
}

/**
 * Traffic Incident from TomTom
 */
export interface TrafficIncident {
  id: string;
  type: string;
  severity: number; // 1-4 (1=minor, 4=severe)
  description: string;
  location: Location;
  startTime: string;
  endTime?: string;
  delay: number; // seconds
  roadName?: string;
}

/**
 * Traffic Service
 * Fetches real-time traffic data from TomTom API
 */
export class TrafficService {
  private apiKey: string;
  private baseUrl = "https://api.tomtom.com";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get traffic flow data for a specific point
   * Uses TomTom Traffic Flow API
   */
  async getTrafficFlow(location: Location): Promise<TrafficFlowData | null> {
    if (!this.apiKey) {
      console.warn("TomTom API key not configured");
      return null;
    }

    try {
      const url = `${this.baseUrl}/traffic/services/4/flowSegmentData/absolute/10/json?key=${this.apiKey}&point=${location.lat},${location.lng}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn(`TomTom Traffic Flow API error: ${response.status}`);
        return null;
      }

      const data = await response.json() as {
        flowSegmentData: {
          currentSpeed: number;
          freeFlowSpeed: number;
          currentTravelTime: number;
          freeFlowTravelTime: number;
          confidence: number;
          roadClosure: boolean;
        };
      };

      const flow = data.flowSegmentData;
      
      // Calculate congestion level based on speed ratio
      const speedRatio = flow.currentSpeed / flow.freeFlowSpeed;
      let congestionLevel: TrafficFlowData["congestionLevel"];
      
      if (speedRatio >= 0.9) congestionLevel = "free";
      else if (speedRatio >= 0.7) congestionLevel = "light";
      else if (speedRatio >= 0.5) congestionLevel = "moderate";
      else if (speedRatio >= 0.3) congestionLevel = "heavy";
      else congestionLevel = "severe";

      return {
        currentSpeed: flow.currentSpeed,
        freeFlowSpeed: flow.freeFlowSpeed,
        currentTravelTime: flow.currentTravelTime,
        freeFlowTravelTime: flow.freeFlowTravelTime,
        confidence: flow.confidence,
        roadClosure: flow.roadClosure,
        congestionLevel,
      };
    } catch (error) {
      console.error("Error fetching traffic flow:", error);
      return null;
    }
  }

  /**
   * Get traffic incidents in a bounding box
   * Uses TomTom Traffic Incidents API
   */
  async getTrafficIncidents(
    bounds: {
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
    }
  ): Promise<TrafficIncident[]> {
    if (!this.apiKey) {
      console.warn("TomTom API key not configured");
      return [];
    }

    try {
      // TomTom uses: minLon,minLat,maxLon,maxLat format
      const bbox = `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`;
      const url = `${this.baseUrl}/traffic/services/5/incidentDetails?key=${this.apiKey}&bbox=${bbox}&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers,aci{probabilityOfOccurrence,numberOfReports,lastReportTime}}}}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn(`TomTom Traffic Incidents API error: ${response.status}`);
        return [];
      }

      const data = await response.json() as {
        incidents?: Array<{
          type: string;
          geometry: {
            type: string;
            coordinates: number[] | number[][];
          };
          properties: {
            id: string;
            iconCategory: number;
            magnitudeOfDelay: number;
            events?: Array<{ description: string; code: string }>;
            startTime: string;
            endTime?: string;
            from?: string;
            to?: string;
            delay?: number;
            roadNumbers?: string[];
          };
        }>;
      };

      if (!data.incidents) return [];

      return data.incidents.map((incident): TrafficIncident => {
        // Get coordinates (handle both point and line geometries)
        let coords: number[] = [0, 0];
        if (incident.geometry.type === "Point") {
          coords = incident.geometry.coordinates as number[];
        } else {
          // For LineString, use the first point
          const lineCoords = incident.geometry.coordinates as number[][];
          coords = lineCoords[0] ?? [0, 0];
        }

        // Map icon category to type
        const typeMap: Record<number, string> = {
          0: "Unknown",
          1: "Accident",
          2: "Fog",
          3: "Dangerous Conditions",
          4: "Rain",
          5: "Ice",
          6: "Jam",
          7: "Lane Closed",
          8: "Road Closed",
          9: "Road Works",
          10: "Wind",
          11: "Flooding",
          14: "Broken Down Vehicle",
        };

        return {
          id: incident.properties.id,
          type: typeMap[incident.properties.iconCategory] || "Unknown",
          severity: incident.properties.magnitudeOfDelay || 1,
          description: incident.properties.events?.[0]?.description || "Traffic incident",
          location: {
            lat: coords[1] ?? 0,
            lng: coords[0] ?? 0,
          },
          startTime: incident.properties.startTime,
          endTime: incident.properties.endTime,
          delay: incident.properties.delay || 0,
          roadName: incident.properties.roadNumbers?.[0],
        };
      });
    } catch (error) {
      console.error("Error fetching traffic incidents:", error);
      return [];
    }
  }

  /**
   * Get traffic data along a route (multiple points)
   */
  async getRouteTrafficFlow(
    coordinates: Array<[number, number]>
  ): Promise<TrafficFlowData[]> {
    // Sample every Nth point to reduce API calls
    const sampleRate = Math.max(1, Math.floor(coordinates.length / 10));
    const sampledPoints = coordinates.filter((_, i) => i % sampleRate === 0);

    const flows = await Promise.all(
      sampledPoints.map((coord) =>
        this.getTrafficFlow({ lat: coord[1], lng: coord[0] })
      )
    );

    return flows.filter((f): f is TrafficFlowData => f !== null);
  }
}

// Singleton instance
let trafficService: TrafficService | null = null;

export function getTrafficService(): TrafficService {
  if (!trafficService) {
    const apiKey = process.env.TOMTOM_API_KEY || "";
    trafficService = new TrafficService(apiKey);
  }
  return trafficService;
}
