import { SlidersHorizontal } from 'lucide-react'
import PlannedPage from '../components/layout/PlannedPage'
export default function MissionBuilder() {
  return (
    <PlannedPage
      title="Mission builder"
      description="The future home of mission configuration."
      phase="PHASE 02"
      icon={SlidersHorizontal}
      items={[
        'Mission information and environmental parameters',
        'Structured custom objectives and validation',
        'Local mission persistence and configuration review',
      ]}
    />
  )
}
