export const categories = [
  'Communications Recovery',
  'Search and Rescue',
  'Humanitarian Logistics',
  'Base Infrastructure Emergency',
  'Defensive Cyber Incident Response',
] as const
export type MissionCategory = (typeof categories)[number]
export const metricDefinitions = {
  communicationUptime: {
    label: 'Communication uptime',
    unit: '%',
    percentage: true,
  },
  equipmentAvailability: {
    label: 'Equipment availability',
    unit: '%',
    percentage: true,
  },
  incidentsResolved: {
    label: 'Incidents resolved',
    unit: '',
    percentage: false,
  },
  suppliesDelivered: {
    label: 'Supplies delivered',
    unit: '%',
    percentage: true,
  },
  systemsRestored: { label: 'Systems restored', unit: '', percentage: false },
} as const
export type MetricKey = keyof typeof metricDefinitions
export type ComparisonOperator = '>=' | '<=' | '='
export interface MissionObjective {
  id: string
  metric: MetricKey
  operator: ComparisonOperator
  target: number
  required: boolean
  deadlineHours?: number
}
export interface MissionParameter {
  weather: 'Clear' | 'Moderate' | 'Severe'
  disruption: 'Low' | 'Medium' | 'High'
  supportTeams: number
  resources: 'Limited' | 'Normal' | 'Abundant'
  equipmentReliability: number
  backupPower: boolean
  connectivity: 'Stable' | 'Intermittent' | 'Unreliable'
}
export interface MissionConfiguration {
  name: string
  description: string
  category: MissionCategory
  durationHours: number
  parameters: MissionParameter
  objectives: MissionObjective[]
}
export interface Mission extends MissionConfiguration {
  id: string
  modifiedAt: string
}
