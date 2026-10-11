import type {
  Facility,
  IncidentKind,
  MissionState,
  RecoveryStep,
} from '../../types/mission'
export const systemMeters = [
  { key: 'communication_health', label: 'Communications', tone: 'blue' },
  { key: 'equipment_availability', label: 'Equipment', tone: 'steel' },
  { key: 'power_availability', label: 'Power', tone: 'amber' },
  { key: 'resource_level', label: 'Resources', tone: 'steel' },
] as const
export const incidentSystem: Record<
  IncidentKind,
  keyof MissionState['systems']
> = {
  communications_outage: 'communication_health',
  power_failure: 'power_availability',
  equipment_degradation: 'equipment_availability',
}
export const facilitySystem: Record<
  Facility['kind'],
  keyof MissionState['systems']
> = {
  relay: 'communication_health',
  power: 'power_availability',
  facility: 'equipment_availability',
}
export const facilityType: Record<Facility['kind'], string> = {
  relay: 'Comm relay',
  power: 'Power generation',
  facility: 'Support facility',
}
export const kindForFacility: Record<Facility['kind'], IncidentKind> = {
  relay: 'communications_outage',
  power: 'power_failure',
  facility: 'equipment_degradation',
}
export function relevantStep(
  step: RecoveryStep,
  kind?: IncidentKind,
  incidentId?: string,
) {
  if (!kind) return true
  if (step.payload.incident_id) return step.payload.incident_id === incidentId
  if (step.command_type === 'restore_service') return true
  return kind === 'power_failure'
    ? step.command_type === 'activate_backup_power'
    : kind === 'communications_outage'
      ? step.command_type === 'activate_backup_communications'
      : step.command_type === 'run_equipment_diagnostic'
}
export function healthTone(value: number) {
  return value < 25 ? 'red' : value < 75 ? 'amber' : 'green'
}
