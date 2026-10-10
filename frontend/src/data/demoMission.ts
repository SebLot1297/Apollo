import type { Mission } from '../types/preview'
export const demoMission: Mission = {
  id: 'demo-aurora',
  name: 'Operation Aurora',
  description:
    'Restore the communications network across the fictional North Haven support district and keep emergency relief teams connected.',
  category: 'Communications Recovery',
  durationHours: 4,
  modifiedAt: '2026-10-09T12:00:00Z',
  parameters: {
    weather: 'Moderate',
    disruption: 'Medium',
    supportTeams: 4,
    resources: 'Normal',
    equipmentReliability: 92,
    backupPower: true,
    connectivity: 'Stable',
  },
  objectives: [
    {
      id: 'obj-uptime',
      metric: 'communicationUptime',
      operator: '>=',
      target: 90,
      required: true,
    },
    {
      id: 'obj-equipment',
      metric: 'equipmentAvailability',
      operator: '>=',
      target: 75,
      required: true,
    },
    {
      id: 'obj-incident',
      metric: 'incidentsResolved',
      operator: '>=',
      target: 1,
      required: false,
    },
  ],
}
