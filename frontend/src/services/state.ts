import { z } from 'zod'
import {
  configurationSchema,
  finite,
  objectiveSchema,
} from '../features/missions/validation'
import type { MissionState } from '../types/mission'
import { ApiError } from './api'

const nonnegative = finite.nonnegative()
export const stateSchema = z
  .object({
    run_id: z.string().uuid(),
    mission_id: z.string().uuid(),
    mission: configurationSchema,
    status: z.enum([
      'created',
      'running',
      'paused',
      'completed',
      'failed',
      'terminated',
    ]),
    elapsed_time_seconds: nonnegative,
    random_seed: finite.int(),
    time_multiplier: finite.positive().max(3600),
    recovery_mode: z.enum(['manual', 'automatic']).default('manual'),
    next_recovery_at_seconds: nonnegative.nullable().optional(),
    sequence: finite.int().nonnegative(),
    metrics: z.record(finite),
    systems: z.object({
      communication_health: finite.min(0).max(100),
      equipment_availability: finite.min(0).max(100),
      power_availability: finite.min(0).max(100),
      resource_level: finite.min(0).max(100),
    }),
    facilities: configurationSchema.shape.facilities,
    support_teams: configurationSchema.shape.support_teams,
    incidents: z.array(
      z.object({
        id: z.string().uuid(),
        kind: z.enum([
          'communications_outage',
          'power_failure',
          'equipment_degradation',
        ]),
        title: z.string(),
        description: z.string(),
        status: z.enum(['active', 'acknowledged', 'resolved']),
        started_at_seconds: nonnegative,
        resolved_at_seconds: nonnegative.nullable(),
      }),
    ),
    events: z.array(
      z.object({
        id: z.string().uuid(),
        sequence: finite.int().positive(),
        simulated_time_seconds: nonnegative,
        event_type: z.string(),
        severity: z.enum(['info', 'warning', 'critical', 'action']),
        message: z.string(),
        payload: z.record(z.unknown()),
      }),
    ),
    objective_results: z.array(
      z.object({
        objective: objectiveSchema,
        achieved_value: finite,
        passed: z.boolean(),
        status: z.enum(['pending', 'passed', 'failed', 'expired']),
        first_achieved_at_seconds: nonnegative.nullable(),
        reason: z.string(),
      }),
    ),
    history: z.array(
      z.object({
        simulated_time_seconds: nonnegative,
        metrics: z.record(finite),
        systems: z.record(finite),
      }),
    ),
    command_history: z
      .array(
        z.object({
          command_type: z.string(),
          source: z.enum(['manual', 'automatic']).optional(),
          payload: z.record(z.unknown()),
          simulated_time_seconds: nonnegative,
          elapsed_time_seconds: nonnegative.optional(),
          timestamp: z.string().optional(),
          effect: z.string().optional(),
        }),
      )
      .optional(),
    backup_communications_active: z.boolean().optional(),
    backup_power_active: z.boolean().optional(),
  })
  .passthrough()

export function parseState(candidate: unknown, runId?: string): MissionState {
  const result = stateSchema.safeParse(candidate)
  if (!result.success || (runId && result.data.run_id !== runId))
    throw new ApiError(
      'The backend returned invalid or mismatched simulation state.',
    )
  return result.data as MissionState
}
export function acceptState(
  current: MissionState | undefined,
  candidate: unknown,
  runId: string,
): MissionState | undefined {
  let incoming: MissionState
  try {
    incoming = parseState(candidate, runId)
  } catch {
    return current
  }
  if (current?.run_id === runId && incoming.sequence <= current.sequence)
    return current
  return incoming
}
export function parseFrame(
  candidate: unknown,
  runId: string,
): {
  type: 'snapshot' | 'update' | 'completion'
  sequence: number
  state: MissionState
} | null {
  const result = z
    .object({
      type: z.enum(['snapshot', 'update', 'completion']),
      sequence: finite.int().nonnegative(),
      state: stateSchema,
    })
    .safeParse(candidate)
  if (
    !result.success ||
    result.data.state.run_id !== runId ||
    result.data.sequence !== result.data.state.sequence
  )
    return null
  return { ...result.data, state: result.data.state as MissionState }
}
