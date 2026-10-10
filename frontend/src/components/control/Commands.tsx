import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type {
  CommandType,
  Incident,
  IncidentKind,
  MissionState,
} from '../../types/mission'
import { isTerminal } from '../../types/mission'
import { useWorkspace } from '../../store/workspace'
import {
  newAction,
  sendAction,
  type ActionRequest,
} from '../../services/commands'
import { ApiError } from '../../services/api'
import { useConfirm } from '../ui/confirmation'
import { ErrorNotice } from '../ui/Feedback'
import { PanelTitle } from '../ui/Primitives'

export default function Commands({
  state,
  incident,
}: {
  state: MissionState
  incident?: Incident
}) {
  const client = useQueryClient(),
    navigate = useNavigate(),
    confirm = useConfirm()
  const pending = useWorkspace((store) => store.pending[state.run_id] ?? false),
    live = useWorkspace((store) => store.connections[state.run_id] === 'live')
  const [uncertain, setUncertain] = useState<ActionRequest | null>(null),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState('')
  const [kind, setKind] = useState<IncidentKind>('power_failure')
  const [speedDraft, setSpeedDraft] = useState<{
    runId: string
    value: string
  } | null>(null)
  const speed =
    speedDraft?.runId === state.run_id
      ? speedDraft.value
      : String(state.time_multiplier)
  const multiplier = Number(speed)
  const invalidSpeed =
    !speed.trim() ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    multiplier > 3600
  const submit = async (action: ActionRequest) => {
    setError(null)
    setNotice('')
    try {
      const accepted = await sendAction(client, action)
      setUncertain(null)
      if (action.command_type === 'set_speed') setSpeedDraft(null)
      setNotice(
        action.command_type === 'set_speed'
          ? `Simulation speed updated to ${accepted.time_multiplier}×.`
          : `${action.command_type.replaceAll('_', ' ')} confirmed by the server. ${accepted.command_history?.at(-1)?.effect ?? ''}`,
      )
      if (action.command_type === 'reset') {
        useWorkspace.getState().selectRun(accepted.run_id)
        navigate(`/mission-control/${accepted.run_id}`)
      }
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.outcomeUnknown)
        setUncertain(action)
    }
  }
  const act = async (
    command: CommandType | 'reset',
    payload: Record<string, unknown> = {},
  ) => {
    if (useWorkspace.getState().pending[state.run_id] || !live || uncertain)
      return
    if (['finish', 'terminate', 'reset'].includes(command)) {
      const descriptions = {
        finish:
          'Evaluate objectives at the current elapsed time. This does not advance to the mission duration.',
        terminate:
          'End this run unsuccessfully. The history and report will be retained.',
        reset:
          'Create a new, stopped run with a new identity. The old report and history remain available.',
      }
      if (
        !(await confirm({
          title: `${command === 'reset' ? 'Reset' : command === 'finish' ? 'Finish' : 'Terminate'} this run?`,
          description: descriptions[command as keyof typeof descriptions],
          confirmText:
            command === 'reset'
              ? 'Create new run'
              : `${command === 'finish' ? 'Finish' : 'Terminate'} run`,
        }))
      )
        return
      if (useWorkspace.getState().pending[state.run_id]) return
    }
    await submit(newAction(state.run_id, command, payload))
  }
  const blocked = pending || !live || Boolean(uncertain)
  return (
    <section className="panel">
      <PanelTitle title="Command console" meta="SERVER-AUTHORITATIVE" />
      <div className="cg-content cg-stack">
        {!live && (
          <p className="cg-help" role="status">
            Commands disabled while disconnected or awaiting a fresh snapshot.
          </p>
        )}
        <ErrorNotice error={error} />
        {notice && (
          <p className="cg-notice success" role="status">
            {notice}
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
        <form
          className="cg-form"
          noValidate
          aria-label="Simulation speed control"
          onSubmit={(event) => {
            event.preventDefault()
            if (blocked || isTerminal(state.status)) return
            if (invalidSpeed) {
              setError(
                new Error(
                  'Enter a simulation speed greater than 0 and at most 3600.',
                ),
              )
              return
            }
            void act('set_speed', { time_multiplier: multiplier })
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
                min="0"
                max="3600"
                step="any"
                value={speed}
                onChange={(event) =>
                  setSpeedDraft({
                    runId: state.run_id,
                    value: event.target.value,
                  })
                }
              />
              <small>
                Current speed: {state.time_multiplier}×. Change this run before
                starting, while running, or while paused.
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
          {state.status === 'created' && (
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => void act('start')}
            >
              Start simulation
            </button>
          )}
          {state.status === 'running' && (
            <button
              className="button"
              disabled={blocked}
              onClick={() => void act('pause')}
            >
              Pause simulation
            </button>
          )}
          {state.status === 'paused' && (
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => void act('resume')}
            >
              Resume simulation
            </button>
          )}
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
          disabled={blocked || !['running', 'paused'].includes(state.status)}
          className="cg-form"
        >
          <legend className="cg-help">
            Recovery actions work while running or paused; paused changes do not
            advance simulated time.
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
