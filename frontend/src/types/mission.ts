export const metricKeys = [
  'communication_uptime_percent',
  'equipment_availability_percent',
  'incidents_resolved',
  'supplies_delivered_percent',
  'systems_restored',
  'elapsed_time_seconds',
] as const
export type MetricKey = (typeof metricKeys)[number]
export type Operator = '>=' | '<=' | '=' | '>' | '<'
export type EvaluationMode = 'final' | 'maintained' | 'deadline' | 'accumulated'
export type RunStatus =
  'created' | 'running' | 'paused' | 'completed' | 'failed' | 'terminated'
export type Scalar = string | number | boolean | null
export interface MissionObjective {
  id: string
  name: string
  description: string
  metric_key: MetricKey
  operator: Operator
  target_value: number
  required: boolean
  evaluation_mode: EvaluationMode
  deadline_seconds: number | null
}
export interface MissionParameters {
  weather_severity: number
  environmental_disruption: number
  team_count: number
  equipment_reliability: number
  resource_level: number
  communication_reliability: number
  backup_power_enabled: boolean
  custom_metadata: Record<string, Scalar>
}
export interface Facility {
  id: string
  name: string
  kind: 'relay' | 'facility' | 'power'
  x: number
  y: number
  status: 'operational' | 'degraded' | 'offline'
}
export interface SupportTeam {
  id: string
  name: string
  x: number
  y: number
  status: 'available' | 'responding'
}
export interface MissionConfiguration {
  id: string
  schema_version: 1
  name: string
  description: string
  category: 'communications_recovery'
  duration_seconds: number
  parameters: MissionParameters
  objectives: MissionObjective[]
  facilities: Facility[]
  support_teams: SupportTeam[]
  created_at: string
  updated_at: string
}
export type IncidentKind =
  'communications_outage' | 'power_failure' | 'equipment_degradation'
export interface Incident {
  id: string
  kind: IncidentKind
  title: string
  description: string
  status: 'active' | 'acknowledged' | 'resolved'
  started_at_seconds: number
  resolved_at_seconds: number | null
}
export interface Event {
  id: string
  sequence: number
  simulated_time_seconds: number
  event_type: string
  severity: 'info' | 'warning' | 'critical' | 'action'
  message: string
  payload: Record<string, unknown>
}
export interface ObjectiveResult {
  objective: MissionObjective
  achieved_value: number
  passed: boolean
  status: 'pending' | 'passed' | 'failed' | 'expired'
  first_achieved_at_seconds: number | null
  reason: string
}
export interface HistorySample {
  simulated_time_seconds: number
  metrics: Record<string, number>
  systems: Record<string, number>
}
export interface PublicSystems {
  communication_health: number
  equipment_availability: number
  power_availability: number
  resource_level: number
}
export interface CommandRecord {
  command_type: string
  payload: Record<string, unknown>
  simulated_time_seconds: number
  elapsed_time_seconds?: number
  timestamp?: string
  effect?: string
}
export interface MissionState {
  run_id: string
  mission_id: string
  mission: MissionConfiguration
  status: RunStatus
  elapsed_time_seconds: number
  random_seed: number
  time_multiplier: number
  sequence: number
  metrics: Record<string, number>
  systems: PublicSystems
  facilities: Facility[]
  support_teams: SupportTeam[]
  incidents: Incident[]
  events: Event[]
  objective_results: ObjectiveResult[]
  history: HistorySample[]
  command_history?: CommandRecord[]
  backup_communications_active?: boolean
  backup_power_active?: boolean
}
export type Provider = 'auto' | 'gemini' | 'qwen' | 'mock'
export interface AIEnvelope<T = { text: string }> {
  provider: Exclude<Provider, 'auto'>
  model: string
  mock: boolean
  fallback_reason: string | null
  data: T
  usage: Record<string, unknown>
  latency_ms: number
}
export interface Report {
  run_id: string
  mission: MissionConfiguration
  success: boolean
  status: RunStatus
  elapsed_time_seconds: number
  final_metrics: Record<string, number>
  objective_results: ObjectiveResult[]
  events: Event[]
  command_history: CommandRecord[]
  telemetry: HistorySample[]
  summary: string
  ai_analysis: AIEnvelope | null
  created_at: string
}
export interface MetricDefinition {
  key: MetricKey
  name: string
  label?: string
  unit: string
  minimum: number
  maximum: number | null
  value_type: 'number' | 'integer'
  supported_modes: EvaluationMode[]
  operators: Operator[]
  calculation: string
}
export interface ParameterDefinition {
  key: string
  name: string
  label?: string
  type: string
  unit: string | null
  default: Scalar | Record<string, Scalar>
  minimum: number | null
  maximum: number | null
  description: string
  effects: string
  validation: string
}
export interface Registry {
  metrics: Record<MetricKey, MetricDefinition>
  parameters: Record<string, ParameterDefinition>
  categories: { key: string; label: string; available: boolean }[]
}
export interface ProviderStatus {
  provider: string
  model: string
  configured: boolean
  available: boolean
  detail: string
}
export interface Preferences {
  ai_provider: Provider
  demo_mode: boolean
  simulation_speed: number
}
export interface Settings extends Preferences {
  database: { engine: string; status: string }
  ai_status: ProviderStatus[]
}
export interface Readiness {
  status: string
  database: { engine: string; status: string }
  simulation_engine_ready: boolean
  ai_service_ready: boolean
}
export type CommandType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'trigger_incident'
  | 'activate_backup_communications'
  | 'activate_backup_power'
  | 'run_equipment_diagnostic'
  | 'restore_service'
  | 'acknowledge_incident'
  | 'finish'
  | 'terminate'
export type ConnectionStatus =
  'connecting' | 'live' | 'reconnecting' | 'offline'
export const isTerminal = (status: RunStatus) =>
  ['completed', 'failed', 'terminated'].includes(status)
