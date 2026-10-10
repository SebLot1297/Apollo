import type { QueryClient } from '@tanstack/react-query'
import type { CommandType } from '../types/mission'
import { useWorkspace } from '../store/workspace'
import { api, ApiError } from './api'
import { cacheState, keys } from './queries'
import { parseState } from './state'

export interface ActionRequest {
  readonly run_id: string
  readonly command_type: CommandType | 'reset'
  readonly payload: Readonly<Record<string, unknown>>
  readonly idempotency_key: string
}
function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
}
export function newAction(
  run_id: string,
  command_type: CommandType | 'reset',
  payload: Record<string, unknown> = {},
): ActionRequest {
  const immutable = structuredClone(payload)
  freeze(immutable)
  return Object.freeze({
    run_id,
    command_type,
    payload: immutable,
    idempotency_key: crypto.randomUUID(),
  })
}
export async function sendAction(client: QueryClient, action: ActionRequest) {
  if (useWorkspace.getState().pending[action.run_id])
    throw new ApiError('An action is already pending for this run.', 409)
  useWorkspace.getState().setPending(action.run_id, true)
  try {
    const incoming =
      action.command_type === 'reset'
        ? await api.reset(action.run_id, action.idempotency_key)
        : await api.command(action.run_id, {
            command_type: action.command_type,
            payload: action.payload,
            idempotency_key: action.idempotency_key,
          })
    const parsed = parseState(
      incoming,
      action.command_type === 'reset' ? undefined : action.run_id,
    )
    if (action.command_type === 'reset' && parsed.run_id === action.run_id)
      throw new ApiError(
        'Reset did not return a new run. Refresh to confirm the server outcome.',
        undefined,
        [],
        undefined,
        true,
      )
    const accepted = cacheState(client, parsed.run_id, parsed)!
    void client.invalidateQueries({ queryKey: keys.runs })
    void client.invalidateQueries({ queryKey: keys.run(action.run_id) })
    return accepted
  } finally {
    useWorkspace.getState().setPending(action.run_id, false)
  }
}
