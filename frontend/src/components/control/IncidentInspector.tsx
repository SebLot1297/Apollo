import { useState } from 'react'
import {
  Activity,
  Building2,
  ChevronDown,
  Coins,
  Radio,
  Users,
  Zap,
} from 'lucide-react'
import type {
  Facility,
  Incident,
  MissionState,
  SupportTeam,
} from '../../types/mission'
import { isTerminal } from '../../types/mission'
import {
  facilitySystem,
  facilityType,
  incidentSystem,
  relevantStep,
} from '../../features/control/presentation'
import type { RunCommands } from '../../features/control/useRunCommands'
import type { RecoveryQuery } from '../../features/control/useRecoveryPlan'
import { simulationClock, number } from '../../utils/format'
import { ErrorNotice, Loading } from '../ui/Feedback'

interface Props {
  state: MissionState
  incident?: Incident
  facility?: Facility
  team?: SupportTeam
  controller: RunCommands
  plan: RecoveryQuery
  onSelectIncident: (id: string | null) => void
}
export default function IncidentInspector({
  state,
  incident,
  facility,
  team,
  controller,
  plan,
  onSelectIncident,
}: Props) {
  const [choice, setChoice] = useState<{
    incident?: string
    step: string
  } | null>(null)
  const steps = plan.data?.steps ?? []
  const actionKey = (step: (typeof steps)[number]) =>
    `${step.command_type}:${JSON.stringify(step.payload)}`
  const first =
    steps.find((step) => relevantStep(step, incident?.kind, incident?.id)) ??
    steps[0]
  const step =
    choice && choice.incident === incident?.id
      ? (steps.find((s) => actionKey(s) === choice.step) ?? first)
      : first
  const key = incident
    ? incidentSystem[incident.kind]
    : facility
      ? facilitySystem[facility.kind]
      : undefined
  const associated = key
    ? state.facilities.filter((f) => facilitySystem[f.kind] === key)
    : []
  const systemName =
    key === 'power_availability'
      ? 'Power'
      : key === 'communication_health'
        ? 'Communications'
        : key === 'equipment_availability'
          ? 'Equipment'
          : 'Systems'
  const terminal = isTerminal(state.status),
    automatic = state.recovery_mode === 'automatic'
  const disabled =
    controller.blocked ||
    automatic ||
    terminal ||
    !['running', 'paused'].includes(state.status) ||
    Boolean(step?.blocked_reason)
  return (
    <aside
      className="incident-inspector"
      data-testid="incident-inspector"
      aria-label="Incident and recovery inspector"
    >
      <div className="inspector-label">
        <span>
          {incident
            ? 'Incident selected'
            : team
              ? 'Support team selected'
              : facility
                ? 'Facility selected'
                : 'System overview'}
        </span>
        <small>
          {incident
            ? `ID ${incident.id.slice(0, 8)}`
            : state.run_id.slice(0, 8)}
        </small>
      </div>
      {state.incidents.some((item) => item.status !== 'resolved') && (
        <label className="cg-field">
          <span>Active incident</span>
          <select
            aria-label="Active incident"
            value={incident?.status !== 'resolved' ? (incident?.id ?? '') : ''}
            onChange={(event) => onSelectIncident(event.target.value || null)}
          >
            <option value="" disabled>
              Select an active incident
            </option>
            {state.incidents
              .filter((item) => item.status !== 'resolved')
              .slice()
              .reverse()
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.status}
                </option>
              ))}
          </select>
        </label>
      )}
      <h2>
        {incident?.title ??
          team?.name ??
          facility?.name ??
          'No active incidents'}
      </h2>
      <p className="inspector-subtitle">
        {team
          ? 'Support team'
          : incident
            ? associated.length
              ? `Associated: ${associated.map((f) => f.name).join(', ')}`
              : `${systemName} system`
            : facility
              ? facilityType[facility.kind]
              : 'Monitor the infrastructure and recovery outlook.'}
      </p>
      <dl className="inspector-facts">
        <div>
          <dt>System</dt>
          <dd>{team ? 'Support' : systemName}</dd>
        </div>
        <div>
          <dt>{incident ? 'Detected' : 'Coordinates'}</dt>
          <dd>
            {incident
              ? simulationClock(incident.started_at_seconds)
              : facility
                ? `${facility.x}, ${facility.y}`
                : team
                  ? `${team.x}, ${team.y}`
                  : '—'}
          </dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd>{key ? number(state.systems[key], '%') : '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd
            className={
              incident && incident.status !== 'resolved' ? 'amber' : 'green'
            }
          >
            {incident?.status ??
              team?.status ??
              facility?.status ??
              'Monitoring'}
          </dd>
        </div>
      </dl>
      <p className="inspector-description">
        {incident?.description ??
          (team
            ? 'Position and availability are confirmed by the simulation. Team markers show synthetic coordinates.'
            : facility
              ? 'This facility shares the health of its associated system. Positions and status come from the saved simulation.'
              : 'Select a facility on the map or choose an incident to inspect its current state.')}
      </p>
      <section className="inspector-recovery">
        <h3>
          <Zap size={20} fill="currentColor" /> Recovery action
        </h3>
        <ErrorNotice error={plan.error} retry={() => void plan.refetch()} />
        {terminal ? (
          <p className="cg-help">
            This run has ended. Open its report or reset it from Run tools.
          </p>
        ) : incident?.status === 'resolved' ? (
          <p className="cg-help">
            This incident is resolved. Its recorded details remain available in
            the report.
          </p>
        ) : plan.error ? (
          <p className="cg-help">
            Recovery guidance is unavailable. Retry above, or use the confirmed
            manual controls in Run tools.
          </p>
        ) : plan.isPending ? (
          <Loading>Loading recovery guidance…</Loading>
        ) : step ? (
          <>
            <h4>{step.title}</h4>
            <p>{step.explanation}</p>
            <div className="action-facts">
              <div>
                <Coins size={19} />
                <span>
                  Cost
                  <strong>
                    {step.cost === null
                      ? 'Unavailable'
                      : `${number(step.cost)} resources`}
                  </strong>
                </span>
              </div>
              <div>
                <Users size={19} />
                <span>
                  Available
                  <strong>
                    {number(state.systems.resource_level)} resources
                  </strong>
                </span>
              </div>
              <div>
                <Activity size={19} />
                <span>
                  System health
                  <strong>{key ? number(state.systems[key], '%') : '—'}</strong>
                </span>
              </div>
            </div>
            <div className="recovery-buttons">
              <button
                className="button recovery-action"
                disabled={disabled}
                onClick={() =>
                  void controller.act(step.command_type, step.payload)
                }
              >
                <Zap size={17} /> Execute action
              </button>
              {steps.length > 1 && (
                <label
                  className="recovery-options-menu"
                  title="Choose recovery action"
                >
                  <span className="sr-only">Recovery option</span>
                  <ChevronDown size={18} aria-hidden="true" />
                  <select
                    aria-label="Recovery option"
                    value={step.id}
                    onChange={(e) =>
                      setChoice({
                        incident: incident?.id,
                        step: actionKey(
                          steps.find((s) => s.id === e.target.value)!,
                        ),
                      })
                    }
                  >
                    {steps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                        {s.blocked_reason ? ' — blocked' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {step.blocked_reason && (
              <p className="cg-help" role="status">
                Blocked: {step.blocked_reason}
              </p>
            )}
            {automatic && (
              <p className="cg-help" role="status">
                Automatic recovery is enabled. Switch to Manual in Run tools to
                execute actions yourself.
              </p>
            )}
            {!controller.live && (
              <p className="cg-help" role="status">
                Recovery actions are disabled while disconnected.
              </p>
            )}
            {state.status === 'created' && (
              <p className="cg-help">
                Start the simulation before executing recovery actions.
              </p>
            )}
            <div className="related-effects">
              <h3>Predicted system effects</h3>
              {Object.entries(step.effects).length ? (
                Object.entries(step.effects).map(([name, value]) => (
                  <div key={name}>
                    <Radio size={15} />
                    <span>{name.replaceAll('_', ' ')}</span>
                    <strong>
                      {value > 0 ? '+' : ''}
                      {number(value)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="cg-help">
                  No numerical effects are available for this step.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="cg-help">No recovery actions are required right now.</p>
        )}
      </section>
      {facility && (
        <div className="inspector-selection">
          <Building2 size={16} /> Selected facility: {facility.name}
        </div>
      )}
    </aside>
  )
}
