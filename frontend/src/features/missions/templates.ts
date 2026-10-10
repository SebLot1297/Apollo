import type {
  MissionConfiguration,
  MissionObjective,
} from '../../types/mission'

export function newObjective(): MissionObjective {
  return {
    id: crypto.randomUUID(),
    name: 'New objective',
    description: '',
    metric_key: 'communication_uptime_percent',
    operator: '>=',
    target_value: 90,
    required: true,
    deadline_seconds: null,
    evaluation_mode: 'final',
  }
}
export function signalRestoreTemplate(): MissionConfiguration {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    schema_version: 1,
    name: 'Operation Signal Restore',
    description:
      'A fictional emergency-support facility has experienced intermittent power and communications outages. Operators must restore services while managing limited equipment availability.',
    category: 'communications_recovery',
    duration_seconds: 21600,
    parameters: {
      weather_severity: 85,
      environmental_disruption: 70,
      team_count: 4,
      equipment_reliability: 75,
      resource_level: 70,
      communication_reliability: 45,
      backup_power_enabled: true,
      custom_metadata: {},
    },
    objectives: [
      { ...newObjective(), name: 'Maintain communication service' },
      {
        ...newObjective(),
        name: 'Restore two systems',
        metric_key: 'systems_restored',
        target_value: 2,
        evaluation_mode: 'deadline',
        deadline_seconds: 21600,
      },
      {
        ...newObjective(),
        name: 'Preserve equipment availability',
        metric_key: 'equipment_availability_percent',
        target_value: 75,
        required: false,
      },
    ],
    facilities: [],
    support_teams: [],
    created_at: now,
    updated_at: now,
  }
}
export function cloneMission(
  mission: MissionConfiguration,
): MissionConfiguration {
  const now = new Date().toISOString()
  return {
    ...structuredClone(mission),
    id: crypto.randomUUID(),
    name: `${mission.name} — copy`,
    objectives: mission.objectives.map((o) => ({
      ...o,
      id: crypto.randomUUID(),
    })),
    facilities: [],
    support_teams: [],
    created_at: now,
    updated_at: now,
  }
}
