import { FileChartColumn } from 'lucide-react'
import PlannedPage from '../components/layout/PlannedPage'
export default function AfterActionReport() {
  return (
    <PlannedPage
      title="After-action reports"
      description="The future home of mission results and performance reviews."
      phase="PHASE 04"
      icon={FileChartColumn}
      items={[
        'Computed success and objective assessment',
        'System performance charts and incident timelines',
        'Local report archive for completed simulations',
      ]}
    />
  )
}
