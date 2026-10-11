import type { RunCommands } from '../../features/control/useRunCommands'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Incident, IncidentKind, MissionState } from '../../types/mission'
import { isTerminal } from '../../types/mission'
import { PanelTitle } from '../ui/Primitives'
import {
  capSimulationSpeed,
  MAX_SIMULATION_SPEED,
  simulationSpeedHelp,
} from '../../utils/simulationSpeed'

export default function Commands({
  state,
  incident,
  controller,
}: {
  state: MissionState
  incident?: Incident
  controller: RunCommands
}) {
  const navigate = useNavigate()
  const {
    pending,
    live,
    uncertain,
    setError,
    setNotice,
    submit: sendRequest,
    act: sendCommand,
    blocked,
    client,
  } = controller
  const [kind, setKind] = useState<IncidentKind>('power_failure')
  const automatic = state.recovery_mode === 'automatic'
  const [speedDraft, setSpeedDraft] = useState<{
    runId: string
    value: string
  } | null>(null)
  const act: RunCommands['act'] = async (command, payload) => {
    const accepted = await sendCommand(command, payload)
    if (accepted && command === 'set_speed') setSpeedDraft(null)
    return accepted
  }
  const submit: RunCommands['submit'] = async (action) => {
    const accepted = await sendRequest(action)
    if (accepted && action.command_type === 'set_speed') setSpeedDraft(null)
    return accepted
  }
  const speed =
    speedDraft?.runId === state.run_id
      ? speedDraft.value
      : String(state.time_multiplier)
  const multiplier = Number(speed)
  const invalidSpeed =
    !speed.trim() || !Number.isFinite(multiplier) || multiplier <= 0
  return (
    <section className="panel">
      <PanelTitle title="Run tools" meta="Server-confirmed controls" />
      <div className="cg-content cg-stack">
        {!live && (
          <p className="cg-help" role="status">
            Commands disabled while disconnected or awaiting a fresh snapshot.
          </p>
        )}
        {uncertain && (
          <div className="cg-stack">
            <p className="cg-help">
              The action outcome is unknown. Retrying uses the same run,
              command, payload, and key:{' '}
              <span className="mono">{uncertain.idempotency_key}</span>.
            </p>
            <div className="cg-actions">
              <button
                className="button"
                disabled={pending || !live}
                onClick={() => void submit(uncertain)}
              >
                Retry same action
              </button>
              <button
                className="button"
                onClick={async () => {
                  await client.invalidateQueries({
                    queryKey: ['run', state.run_id],
                  })
                  setNotice(
                    'State refreshed. Retry the original action to confirm its outcome before issuing a new action.',
                  )
                }}
              >
                Refresh run state
              </button>
            </div>
          </div>
        )}
        <fieldset
          className="cg-form"
          disabled={blocked || isTerminal(state.status)}
        >
          <legend>Recovery commands</legend>
          <label className="cg-check">
            <input
              type="checkbox"
              role="switch"
              aria-label="Automatic recovery"
              checked={automatic}
              onChange={(event) =>
                void act('set_recovery_mode', {
                  recovery_mode: event.target.checked ? 'automatic' : 'manual',
                })
              }
            />
            Automatic recovery
          </label>
          <p className="cg-help" role="status">
            {automatic
              ? 'Automatic: the simulation repairs damage and resolves incidents using real recovery commands and available resources. Attempts are scheduled 10 simulated seconds after damage is detected. Pausing also pauses recovery.'
              : 'Manual: choose recovery commands yourself. Incidents and damaged equipment are not repaired automatically.'}
          </p>
          {automatic && state.next_recovery_at_seconds != null && (
            <p className="cg-help">
              Next automatic recovery attempt: T+
              {state.next_recovery_at_seconds.toFixed(1)}s.
            </p>
          )}
          {automatic && state.run_profile === 'guided_demo' && (
            <p className="cg-help">
              Guided incident pauses are disabled in Automatic mode so the demo
              can run unattended.
            </p>
          )}
        </fieldset>
        <form
          className="cg-form"
          noValidate
          aria-label="Simulation speed control"
          onSubmit={(event) => {
            event.preventDefault()
            if (blocked || isTerminal(state.status)) return
            if (invalidSpeed) {
              setError(
                new Error('Enter a finite simulation speed greater than 0.'),
              )
              return
            }
            void act('set_speed', {
              time_multiplier: capSimulationSpeed(multiplier),
            })
          }}
        >
          <fieldset
            className="cg-form"
            disabled={blocked || isTerminal(state.status)}
          >
            <legend>Simulation speed</legend>
            <label className="cg-field">
              <span>Run speed (×)</span>
              <input
                type="number"
                aria-label="Run speed (×)"
                aria-invalid={invalidSpeed}
                aria-describedby="run-speed-help"
                min="0"
                max={MAX_SIMULATION_SPEED}
                step="any"
                value={speed}
                onChange={(event) =>
                  setSpeedDraft({
                    runId: state.run_id,
                    value: event.target.value,
                  })
                }
              />
              <small id="run-speed-help">
                Current speed: {state.time_multiplier}×. Change this run before
                starting, while running, or while paused. {simulationSpeedHelp}
              </small>
            </label>
            <div className="cg-actions" aria-label="Speed presets">
              {[1, 5, 10, 30, 60, 120].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`button${state.time_multiplier === preset ? ' primary' : ''}`}
                  aria-pressed={state.time_multiplier === preset}
                  disabled={state.time_multiplier === preset}
                  onClick={() =>
                    void act('set_speed', { time_multiplier: preset })
                  }
                >
                  {preset}×
                </button>
              ))}
            </div>
            <button className="button primary" type="submit">
              Apply speed
            </button>
          </fieldset>
          <p className="cg-help">
            This control changes only this run.{' '}
            <Link to="/settings">
              Save the default speed for all missions in Settings
            </Link>
            .
          </p>
        </form>
        <div className="cg-actions">
          {['running', 'paused'].includes(state.status) && (
            <button
              className="button"
              disabled={blocked}
              onClick={() => void act('finish')}
            >
              Finish simulation
            </button>
          )}
          {!isTerminal(state.status) && (
            <button
              className="button warning"
              disabled={blocked}
              onClick={() => void act('terminate')}
            >
              Terminate simulation
            </button>
          )}
          {isTerminal(state.status) && (
            <>
              <button
                className="button"
                onClick={() => navigate(`/reports/${state.run_id}`)}
              >
                View report
              </button>
              <button
                className="button"
                disabled={blocked}
                onClick={() => void act('reset')}
              >
                Reset to new run
              </button>
            </>
          )}
        </div>
        <fieldset
          disabled={blocked || state.status !== 'running'}
          className="cg-form"
        >
          <legend className="cg-help">
            Synthetic incident injection is available only while running.
          </legend>
          <label className="cg-field">
            <span>Synthetic incident kind</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as IncidentKind)}
            >
              <option value="power_failure">Power failure</option>
              <option value="communications_outage">
                Communications outage
              </option>
              <option value="equipment_degradation">
                Equipment degradation
              </option>
            </select>
          </label>
          <div className="cg-actions">
            <button
              className="button"
              onClick={() => void act('trigger_incident', { kind })}
            >
              Trigger incident
            </button>
          </div>
        </fieldset>
        <fieldset
          disabled={
            blocked ||
            automatic ||
            !['running', 'paused'].includes(state.status)
          }
          className="cg-form"
        >
          <legend className="cg-help">
            {automatic
              ? 'Manual recovery commands are disabled. Switch off Automatic recovery to use these controls.'
              : 'Recovery actions work while running or paused; paused changes do not advance simulated time.'}
          </legend>
          <div className="cg-actions">
            <button
              className="button"
              disabled={!incident || incident.status !== 'active'}
              onClick={() =>
                void act('acknowledge_incident', { incident_id: incident?.id })
              }
            >
              Acknowledge selected incident
            </button>
            <button
              className="button"
              disabled={!incident || incident.status === 'resolved'}
              onClick={() =>
                void act('restore_service', { incident_id: incident?.id })
              }
            >
              Restore selected incident
            </button>
            <button
              className="button"
              onClick={() => void act('restore_service')}
            >
              Restore impaired services
            </button>
            <button
              className="button"
              onClick={() => void act('activate_backup_communications')}
            >
              Activate backup communications
            </button>
            <button
              className="button"
              disabled={!state.mission.parameters.backup_power_enabled}
              title={
                state.mission.parameters.backup_power_enabled
                  ? undefined
                  : 'Backup power is not enabled for this mission.'
              }
              onClick={() => void act('activate_backup_power')}
            >
              Activate backup power
            </button>
            <button
              className="button"
              onClick={() => void act('run_equipment_diagnostic')}
            >
              Run equipment diagnostic
            </button>
          </div>
          {!state.mission.parameters.backup_power_enabled && (
            <small className="cg-help">
              Backup power capability is disabled in this mission configuration.
            </small>
          )}
        </fieldset>
        {pending && (
          <p role="status">Waiting for the server to confirm the action…</p>
        )}
      </div>
    </section>
  )
}
