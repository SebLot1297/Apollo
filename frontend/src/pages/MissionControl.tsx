import { Radio } from 'lucide-react'
import PlannedPage from '../components/layout/PlannedPage'
export default function MissionControl() {
  return (
    <PlannedPage
      title="Mission control"
      description="The future home of your command center."
      phase="PHASE 03"
      icon={Radio}
      items={[
        'Interactive fictional map and system telemetry',
        'Deterministic communications outage and recovery demo',
        'Simulation controls, objective progress, and event feed',
      ]}
    />
  )
}
