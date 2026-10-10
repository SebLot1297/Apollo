import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { CommandType, MissionState } from '../../types/mission'
import { useWorkspace } from '../../store/workspace'
import {
  newAction,
  sendAction,
  type ActionRequest,
} from '../../services/commands'
import { ApiError } from '../../services/api'
import { useConfirm } from '../../components/ui/confirmation'

export function useRunCommands(state: MissionState) {
  const client = useQueryClient(),
    navigate = useNavigate(),
    confirm = useConfirm()
  const pending = useWorkspace((store) => store.pending[state.run_id] ?? false)
  const live = useWorkspace(
    (store) => store.connections[state.run_id] === 'live',
  )
  const [uncertain, setUncertain] = useState<ActionRequest | null>(null)
  const [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState('')
  const submit = async (action: ActionRequest) => {
    setError(null)
    setNotice('')
    try {
      const accepted = await sendAction(client, action)
      setUncertain(null)
      setNotice(
        action.command_type === 'set_speed'
          ? `Simulation speed updated to ${accepted.time_multiplier}×.`
          : action.command_type === 'set_recovery_mode'
            ? `Recovery mode updated to ${accepted.recovery_mode}.`
            : `${action.command_type.replaceAll('_', ' ')} confirmed by the server. ${accepted.command_history?.at(-1)?.effect ?? ''}`,
      )
      void client.invalidateQueries({
        queryKey: ['recovery-plan', state.run_id],
      })
      if (action.command_type === 'reset') {
        useWorkspace.getState().selectRun(accepted.run_id)
        navigate(`/mission-control/${accepted.run_id}`)
      }
      return accepted
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
      const label =
        command === 'reset'
          ? 'Reset'
          : command === 'finish'
            ? 'Finish'
            : 'Terminate'
      if (
        !(await confirm({
          title: `${label} this run?`,
          description: descriptions[command as keyof typeof descriptions],
          confirmText: command === 'reset' ? 'Create new run' : `${label} run`,
        }))
      )
        return
      if (useWorkspace.getState().pending[state.run_id]) return
    }
    return submit(newAction(state.run_id, command, payload))
  }
  return {
    act,
    submit,
    pending,
    live,
    uncertain,
    error,
    setError,
    notice,
    setNotice,
    blocked: pending || !live || Boolean(uncertain),
    client,
  }
}
export type RunCommands = ReturnType<typeof useRunCommands>
