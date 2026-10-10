import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MissionState } from '../../types/mission'
import { isTerminal } from '../../types/mission'
import { api } from '../../services/api'
import {
  newAction,
  sendAction,
  type ActionRequest,
} from '../../services/commands'
import { useWorkspace } from '../../store/workspace'
import { ErrorNotice, Loading } from '../ui/Feedback'
import { PanelTitle } from '../ui/Primitives'
import { number } from '../../utils/format'

const key = (runId: string) => ['recovery-plan', runId] as const

export default function RecoveryPlan({ state }: { state: MissionState }) {
  const client = useQueryClient()
  const pending = useWorkspace((store) => store.pending[state.run_id] ?? false)
  const live = useWorkspace(
    (store) => store.connections[state.run_id] === 'live',
  )
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const terminal = isTerminal(state.status)
  const automatic = state.recovery_mode === 'automatic'
  // Refresh after incidents, pause/resume, and confirmed actions; poll while running.
  const unresolved = state.incidents.filter(
    (i) => i.status !== 'resolved',
  ).length
  const revision = `${state.status}:${unresolved}:${state.recovery_mode ?? 'manual'}`
  useEffect(() => {
    void client.invalidateQueries({ queryKey: key(state.run_id) })
  }, [client, state.run_id, revision])
  const plan = useQuery({
    queryKey: key(state.run_id),
    queryFn: ({ signal }) => api.recoveryPlan(state.run_id, signal),
    enabled: !terminal && Boolean(state.run_id),
    refetchInterval: state.status === 'running' ? 5000 : false,
    staleTime: 0,
  })
  const run = async (action: ActionRequest, label: string) => {
    setError(null)
    setNotice('')
    try {
      const accepted = await sendAction(client, action)
      setNotice(
        `${label} confirmed. ${accepted.command_history?.at(-1)?.effect ?? ''}`,
      )
      void client.invalidateQueries({ queryKey: key(state.run_id) })
    } catch (failure) {
      setError(failure)
    }
  }
  const blocked = pending || !live
  const steps = plan.data?.steps ?? []
  const outlook = plan.data?.objective_outlook
  return (
    <section className="panel" data-testid="recovery-plan">
      <PanelTitle title="Recovery plan" meta="ENGINE-DERIVED" />
      <div className="cg-content cg-stack">
        {!live && (
          <p className="cg-help" role="status">
            Guidance is read-only while disconnected; actions stay disabled.
          </p>
        )}
        <ErrorNotice
          error={error ?? plan.error}
          retry={() => void plan.refetch()}
        />
        {notice && (
          <p className="cg-notice success" role="status">
            {notice}
          </p>
        )}
        {terminal ? (
          <p className="cg-help">
            This run has ended. Guidance is available while a run is created,
            running, or paused.
          </p>
        ) : plan.isPending ? (
          <Loading />
        ) : (
          <>
            <p className="cg-help">
              {automatic
                ? 'Automatic recovery is enabled. The simulation schedules its own repairs using available resources. Switch to Manual in the Command console to execute actions yourself.'
                : 'Recommended in priority order. Effects and costs are previewed by the engine on a copied snapshot; nothing is applied until you execute a step.'}
            </p>
            {steps.length ? (
              <ul className="cg-list">
                {steps.map((step) => (
                  <li key={step.id}>
                    <div className="cg-actions spread">
                      <strong>{step.title}</strong>
                      <span className="cg-help">
                        {step.cost !== null
                          ? `${number(step.cost)} resources`
                          : 'cost unavailable'}
                      </span>
                    </div>
                    <p>{step.explanation}</p>
                    {Object.keys(step.effects).length > 0 && (
                      <span className="cg-help">
                        Predicted:{' '}
                        {Object.entries(step.effects)
                          .map(
                            ([system, delta]) =>
                              `${system} ${delta > 0 ? '+' : ''}${delta}`,
                          )
                          .join(', ')}
                      </span>
                    )}
                    {step.blocked_reason ? (
                      <p className="cg-help" role="status">
                        Blocked: {step.blocked_reason}
                      </p>
                    ) : (
                      <button
                        className="button"
                        disabled={blocked || automatic}
                        onClick={() =>
                          void run(
                            newAction(
                              state.run_id,
                              step.command_type,
                              step.payload,
                            ),
                            step.title,
                          )
                        }
                      >
                        Execute action
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cg-empty">
                No recovery actions are required right now.
              </p>
            )}
            {outlook && (
              <div className="cg-stack">
                <h3 className="cg-section-title">Objective outlook</h3>
                <p className="cg-help">{outlook.note}</p>
                {outlook.required_objectives.length > 0 && (
                  <ul className="cg-list">
                    {outlook.required_objectives.map((item) => (
                      <li key={`${item.metric_key}:${item.name}`}>
                        <strong>{item.name}</strong> ·{' '}
                        {item.passed ? 'passing' : item.status} · observed{' '}
                        {number(item.achieved_value)} {item.operator} target{' '}
                        {number(item.target_value)}
                        <p className="cg-help">{item.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {outlook.can_finish_successfully && (
                  <button
                    className="button primary"
                    disabled={blocked}
                    onClick={() =>
                      void run(
                        newAction(state.run_id, 'finish'),
                        'Finish successfully',
                      )
                    }
                  >
                    Finish successfully
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
