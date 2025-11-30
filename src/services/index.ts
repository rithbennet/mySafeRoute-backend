/**
 * Services Index
 *
 * Export all services for easy importing
 */

export {
  routingService,
  type Coordinates,
  type RouteResult,
} from "./routing.service";
export {
  destinationService,
  type Severity,
  type HospitalResult,
} from "./destination.service";
export {
  dispatchService,
  type DispatchRequest,
  type DispatchResult,
  type AmbulanceCandidate,
} from "./dispatch.service";
export {
  simulationService,
  type SimulationConfig,
  type SimulationPhase,
} from "./simulation.service";
export {
  scenarioService,
  type ScenarioRequest,
  type ScenarioResult,
  type AIAnalysisResult,
  type IncidentCategory,
  type IncidentSeverity,
} from "./scenario.service";
