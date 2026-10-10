import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Pause, Play } from 'lucide-react'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import { Empty, ErrorNotice, Loading } from '../components/ui/Feedback'
import ScenarioMap from '../components/dashboard/ScenarioMap'
import Commands from '../components/control/Commands'
import RecoveryPlan from '../components/control/RecoveryPlan'
import ObjectiveResults from '../components/control/ObjectiveResults'
import Events from '../components/control/Events'
import Telemetry from '../components/reports/Telemetry'
import Assistant from '../components/ai/Assistant'
import IncidentInspector from '../components/control/IncidentInspector'
import OperationsSummary from '../components/control/OperationsSummary'
import { useRegistry, useRun, useRuns } from '../services/queries'
import { useWorkspace } from '../store/workspace'
import { elapsed, number, simulationClock } from '../utils/format'
import { useRunCommands } from '../features/control/useRunCommands'
import { useRecoveryPlan } from '../features/control/useRecoveryPlan'
import { kindForFacility, systemMeters } from '../features/control/presentation'
import { isTerminal, type MissionState } from '../types/mission'

export default function MissionControl() {
  const { runId = '' } = useParams(),
    client = useQueryClient(),
    runs = useRuns(client),
    query = useRun(runId, client)
  if (runId && query.data)
    return (
      <LiveWorkspace
        key={runId}
        state={query.data}
        error={query.error}
        retry={() => void query.refetch()}
      />
    )
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow=""
        title="Mission control"
        description="Select a simulation to view confirmed server state."
      />
      <ErrorNotice
        error={runId ? query.error : runs.error}
        retry={() => void (runId ? query.refetch() : runs.refetch())}
      />
      {(runId ? query.isPending : runs.isPending) ? (
        <Loading />
      ) : !runId && runs.data?.length ? (
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
      )}
    </div>
  )
}
function LiveWorkspace({
  state,
  error,
  retry,
}: {
  state: MissionState
  error: unknown
  retry: () => void
}) {
  const controller = useRunCommands(state),
    plan = useRecoveryPlan(state),
    registry = useRegistry()
  const selection = useWorkspace((s) => s.selectedIncidentId),
    markerId = useWorkspace((s) => s.markerSelections[state.run_id] ?? null)
  const previousIncidents = useRef(state.incidents)
  const facility = state.facilities.find((f) => f.id === markerId),
    team = state.support_teams.find((t) => t.id === markerId)
  const explicit = state.incidents.find((i) => i.id === selection)
  const related = facility
    ? state.incidents
        .filter(
          (i) =>
            i.kind === kindForFacility[facility.kind] &&
            i.status !== 'resolved',
        )
        .at(-1)
    : undefined
  const incident =
    explicit ??
    (team
      ? undefined
      : facility
        ? related
        : state.incidents.filter((i) => i.status !== 'resolved').at(-1))
  useEffect(() => {
    if (
      markerId &&
      !state.facilities.some((f) => f.id === markerId) &&
      !state.support_teams.some((t) => t.id === markerId)
    )
      useWorkspace.getState().selectMarker(state.run_id, null)
    const selected = state.incidents.find((i) => i.id === selection)
    const previous = previousIncidents.current.find((i) => i.id === selection)
    if (
      selection &&
      (!selected ||
        (selected.status === 'resolved' && previous?.status !== 'resolved'))
    )
      useWorkspace.getState().selectIncident(null)
    previousIncidents.current = state.incidents
  }, [
    markerId,
    selection,
    state.run_id,
    state.facilities,
    state.support_teams,
    state.incidents,
    state.status,
  ])
  const mode =
    state.status === 'created'
      ? 'start'
      : state.status === 'running'
        ? 'pause'
        : 'resume'
  return (
    <div className="mission-workspace">
      <section
        className="mission-strip"
        data-testid="mission-strip"
        aria-label="Run overview"
      >
        <div className="mission-identity">
          <h1>{state.mission.name}</h1>
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
          <span
            className="mission-time"
            aria-label="Simulation elapsed and duration"
          >
            {simulationClock(state.elapsed_time_seconds)}{' '}
            <span>/ {simulationClock(state.mission.duration_seconds)}</span>
          </span>
          {!isTerminal(state.status) && (
            <button
              className="button"
              aria-label={`${mode === 'start' ? 'Start' : mode === 'pause' ? 'Pause' : 'Resume'} simulation`}
              disabled={controller.blocked}
              onClick={() => void controller.act(mode)}
            >
              {mode === 'pause' ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {mode === 'start'
                ? 'Start'
                : mode === 'pause'
                  ? 'Pause'
                  : 'Resume'}
            </button>
          )}
        </div>
        <div className="mission-meters">
          {systemMeters.map(({ key, label, tone }) => (
            <div className={`system-meter tone-${tone}`} key={key}>
              <span>{label}</span>
              <div>
                <span className="meter-track">
                  <i style={{ width: `${state.systems[key]}%` }} />
                </span>
                <strong data-testid={key}>
                  {number(state.systems[key], '%')}
                </strong>
              </div>
            </div>
          ))}
        </div>
        <span data-testid="elapsed-seconds" className="sr-only">
          {number(state.elapsed_time_seconds)} seconds
        </span>
        <span className="sr-only">Speed {state.time_multiplier}×</span>
        <span className="sr-only">Sequence {state.sequence}</span>
      </section>
      <div className="operations-workspace" data-testid="operations-workspace">
        {(error ||
          controller.error ||
          controller.notice ||
          !controller.live) && (
          <div className="run-feedback">
            <ErrorNotice
              error={error ?? controller.error}
              retry={error ? retry : undefined}
            />
            {controller.notice && (
              <p className="cg-notice success" role="status">
                {controller.notice}
              </p>
            )}
            {!controller.live && (
              <p role="status" className="cg-help">
                Connection is not live. Commands stay disabled until a fresh
                snapshot is confirmed.
              </p>
            )}
          </div>
        )}
        <ScenarioMap
          variant="full"
          facilities={state.facilities}
          teams={state.support_teams}
          systems={state.systems}
          selectedId={markerId}
          incidentKind={
            incident?.status === 'resolved' ? undefined : incident?.kind
          }
          onSelect={(id) => {
            useWorkspace.getState().selectMarker(state.run_id, id)
            useWorkspace.getState().selectIncident(null)
          }}
        />
        <IncidentInspector
          state={state}
          incident={incident}
          facility={facility}
          team={team}
          controller={controller}
          plan={plan}
        />
      </div>
      <OperationsSummary state={state} />
      <div className="workspace-details cg-stack">
        <div className="run-detail-line">
          <span>
            Run {state.run_id.slice(0, 8)} · Sequence {state.sequence}
          </span>
          <span>
            {state.run_profile === 'guided_demo' ? (
              <Badge tone="cyan">Guided demo</Badge>
            ) : (
              'Standard simulation'
            )}{' '}
            · Recovery:{' '}
            {state.recovery_mode === 'automatic' ? 'Automatic' : 'Manual'} ·
            Speed {state.time_multiplier}×
          </span>
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
                .map((i) => (
                  <li key={i.id}>
                    <button
                      className="cg-inspect"
                      aria-pressed={incident?.id === i.id}
                      onClick={() => {
                        useWorkspace.getState().selectIncident(i.id)
                        useWorkspace.getState().selectMarker(state.run_id, null)
                      }}
                    >
                      {i.title} · {i.status} · T+ {number(i.started_at_seconds)}
                      s
                    </button>
                    {incident?.id === i.id && (
                      <>
                        <p>{i.description}</p>
                        <span className="cg-help">
                          Resolved at:{' '}
                          {i.resolved_at_seconds === null
                            ? 'Not resolved'
                            : `${number(i.resolved_at_seconds)} seconds`}
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
        <Commands state={state} incident={incident} controller={controller} />
        <RecoveryPlan state={state} controller={controller} plan={plan} />
        <ObjectiveResults results={state.objective_results} />
        <Telemetry history={state.history} />
        <div className="cg-grid">
          <div id="full-event-history">
            <Events events={state.events} />
          </div>
          <Assistant
            key={state.run_id}
            runId={state.run_id}
            incident={incident}
            sequence={state.sequence}
          />
        </div>
      </div>
    </div>
  )
}
