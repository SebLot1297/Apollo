import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import { Empty, ErrorNotice, Loading } from '../components/ui/Feedback'
import ScenarioMap from '../components/dashboard/ScenarioMap'
import Commands from '../components/control/Commands'
import RecoveryPlan from '../components/control/RecoveryPlan'
import ObjectiveResults from '../components/control/ObjectiveResults'
import Events from '../components/control/Events'
import Telemetry from '../components/reports/Telemetry'
import Assistant from '../components/ai/Assistant'
import { useRegistry, useRun, useRuns } from '../services/queries'
import { useWorkspace } from '../store/workspace'
import { elapsed, number } from '../utils/format'

export default function MissionControl() {
  const { runId = '' } = useParams(),
    client = useQueryClient(),
    runs = useRuns(client),
    query = useRun(runId, client),
    registry = useRegistry()
  const selectedIncidentId = useWorkspace((store) => store.selectedIncidentId),
    connection = useWorkspace(
      (store) => store.connections[runId] ?? 'connecting',
    )
  const state = query.data,
    incident =
      state?.incidents.find((item) => item.id === selectedIncidentId) ??
      state?.incidents.find((item) => item.status !== 'resolved')
  const systemLabels = {
    communication_health: 'Communication health',
    equipment_availability: 'Equipment availability',
    power_availability: 'Power availability',
    resource_level: 'Resource level',
  } as const
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow="LIVE OPERATIONS"
        title="Mission control"
        description={
          state?.mission.name ?? 'Select a run to view confirmed server state.'
        }
      >
        {runId && (
          <Badge tone={connection === 'live' ? 'green' : 'amber'}>
            {connection}
          </Badge>
        )}
      </PageHeading>
      <ErrorNotice
        error={runId ? query.error : runs.error}
        retry={() => void (runId ? query.refetch() : runs.refetch())}
      />
      {!runId ? (
        runs.isPending ? (
          <Loading />
        ) : runs.data?.length ? (
          <section className="panel cg-content cg-stack">
            <h2 className="cg-section-title">Select a simulation</h2>
            <p className="cg-help">
              Saved missions appear here after you launch them.{' '}
              <Link to="/">Choose a saved mission on the dashboard</Link>
            </p>
            {runs.data.map((run) => (
              <Link
                className="button"
                key={run.run_id}
                to={`/mission-control/${run.run_id}`}
              >
                {run.mission.name} · {run.status} · {run.run_id.slice(0, 8)}
              </Link>
            ))}
          </section>
        ) : (
          <Empty title="No simulations">
            <Link className="button" to="/">
              Launch a saved mission from the dashboard
            </Link>
          </Empty>
        )
      ) : query.isPending ? (
        <Loading />
      ) : (
        state && (
          <>
            <section
              className="panel cg-content cg-actions spread"
              aria-label="Run overview"
            >
              <Badge
                tone={
                  ['running', 'completed'].includes(state.status)
                    ? 'green'
                    : ['failed', 'terminated'].includes(state.status)
                      ? 'red'
                      : 'amber'
                }
              >
                {state.status}
              </Badge>
              <span className="mono" data-testid="elapsed-seconds">
                {number(state.elapsed_time_seconds)} seconds
              </span>
              <span>
                Duration {state.mission.duration_seconds} seconds · Speed{' '}
                {state.time_multiplier}×
              </span>
              {state.run_profile === 'guided_demo' && (
                <Badge tone="cyan">Guided demo</Badge>
              )}
              {['running', 'paused'].includes(state.status) && (
                <span data-testid="remaining-wall-time">
                  ≈{' '}
                  {elapsed(
                    Math.max(
                      0,
                      (state.mission.duration_seconds -
                        state.elapsed_time_seconds) /
                        state.time_multiplier,
                    ),
                  )}{' '}
                  wall time remaining
                </span>
              )}
              <span className="cg-help">
                Sequence {state.sequence} · T+{' '}
                {elapsed(state.elapsed_time_seconds)}
              </span>
              <p className="cg-help">
                This run keeps its mission configuration from launch. Change its
                speed in the Command console below, or save a default for all
                missions in Settings.
              </p>
            </section>
            <div className="cg-systems">
              {Object.entries(systemLabels).map(([key, label]) => (
                <section className="cg-system" key={key}>
                  <h2>{label}</h2>
                  <strong
                    style={{
                      color:
                        state.systems[key as keyof typeof systemLabels] < 25
                          ? 'var(--red)'
                          : state.systems[key as keyof typeof systemLabels] < 75
                            ? 'var(--amber)'
                            : 'var(--green)',
                    }}
                    data-testid={key}
                  >
                    {number(
                      state.systems[key as keyof typeof systemLabels],
                      '%',
                    )}
                  </strong>
                  <meter
                    min={0}
                    max={100}
                    low={25}
                    high={75}
                    optimum={100}
                    value={state.systems[key as keyof typeof systemLabels]}
                    aria-label={label}
                  />
                </section>
              ))}
            </div>
            <div className="cg-grid">
              <section className="panel">
                <PanelTitle title="Operational map" />
                <ScenarioMap
                  facilities={state.facilities}
                  teams={state.support_teams}
                />
              </section>
              <section className="panel">
                <PanelTitle title="Registered metrics" />
                <ErrorNotice
                  error={registry.error}
                  retry={() => void registry.refetch()}
                />
                <dl className="cg-facts cg-content">
                  {Object.entries(state.metrics).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {registry.data?.metrics[
                          key as keyof typeof registry.data.metrics
                        ]?.name ?? key}
                      </dt>
                      <dd>
                        {number(
                          value,
                          registry.data?.metrics[
                            key as keyof typeof registry.data.metrics
                          ]?.unit,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
            <div className="cg-grid">
              <section className="panel">
                <PanelTitle
                  title="Incidents"
                  meta={`${state.incidents.filter((i) => i.status !== 'resolved').length} unresolved`}
                />
                <ul className="cg-list">
                  {state.incidents
                    .slice()
                    .reverse()
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          className="cg-inspect"
                          aria-pressed={incident?.id === item.id}
                          onClick={() =>
                            useWorkspace.getState().selectIncident(item.id)
                          }
                        >
                          {item.title} · {item.status} · T+{' '}
                          {number(item.started_at_seconds)}s
                        </button>
                        {incident?.id === item.id && (
                          <>
                            <p>{item.description}</p>
                            <span className="cg-help">
                              Resolved at:{' '}
                              {item.resolved_at_seconds === null
                                ? 'Not resolved'
                                : `${number(item.resolved_at_seconds)} seconds`}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                </ul>
                {!state.incidents.length && (
                  <p className="cg-empty">No incidents recorded.</p>
                )}
              </section>
              <Commands key={state.run_id} state={state} incident={incident} />
            </div>
            <RecoveryPlan key={`plan-${state.run_id}`} state={state} />
            <ObjectiveResults results={state.objective_results} />
            <Telemetry history={state.history} />
            <div className="cg-grid">
              <Events events={state.events} />
              <Assistant
                key={state.run_id}
                runId={state.run_id}
                incident={incident}
                sequence={state.sequence}
              />
            </div>
          </>
        )
      )}
    </div>
  )
}
