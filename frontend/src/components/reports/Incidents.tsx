import { useQueryClient } from '@tanstack/react-query'
import { useRun } from '../../services/queries'
import { incidentSystem } from '../../features/control/presentation'
import { number } from '../../utils/format'
import { Badge } from '../ui/Primitives'
import ReportSection from './ReportSection'
import { ErrorNotice, Loading } from '../ui/Feedback'

const systemNames = {
  communication_health: 'Communications',
  equipment_availability: 'Equipment',
  power_availability: 'Power',
  resource_level: 'Resources',
} as const

export default function Incidents({ runId }: { runId: string }) {
  // Reports omit incident details; use the persisted terminal run with the same ID.
  // Reset creates a new run, so this snapshot continues to describe the original run.
  const client = useQueryClient(),
    run = useRun(runId, client)
  return (
    <ReportSection
      key={runId}
      title="Incidents"
      label="Incident history"
      meta={run.data ? `${run.data.incidents.length} recorded` : undefined}
    >
      <ErrorNotice error={run.error} retry={() => void run.refetch()} />
      {run.isPending ? (
        <Loading>Loading incident history…</Loading>
      ) : (
        run.data && (
          <>
            <ul className="cg-list">
              {run.data.incidents
                .slice()
                .reverse()
                .map((incident) => (
                  <li key={incident.id}>
                    <div className="cg-actions spread">
                      <h3>{incident.title}</h3>
                      <Badge
                        tone={
                          incident.status === 'resolved' ? 'green' : 'amber'
                        }
                      >
                        {incident.status}
                      </Badge>
                    </div>
                    <p>{incident.description}</p>
                    <p className="cg-help">
                      {systemNames[incidentSystem[incident.kind]]} system ·
                      Detected at T+ {number(incident.started_at_seconds)}s ·
                      Resolved at:{' '}
                      {incident.resolved_at_seconds === null
                        ? 'Not resolved'
                        : `T+ ${number(incident.resolved_at_seconds)}s`}
                    </p>
                  </li>
                ))}
            </ul>
            {!run.data.incidents.length && (
              <p className="cg-empty">No incidents recorded.</p>
            )}
          </>
        )
      )}
    </ReportSection>
  )
}
