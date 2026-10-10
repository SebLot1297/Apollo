import { z } from 'zod'
import {
  metricKeys,
  type MissionConfiguration,
  type Registry,
  type Scalar,
} from '../../types/mission'

export const finite = z
  .number({ invalid_type_error: 'Enter a finite number; blank is invalid.' })
  .finite('Enter a finite number.')
const percentage = finite.min(0).max(100)
export const objectiveSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, 'Name cannot be blank.'),
    description: z.string(),
    metric_key: z.enum(metricKeys),
    operator: z.enum(['>=', '<=', '=', '>', '<']),
    target_value: finite.nonnegative(),
    required: z.boolean(),
    evaluation_mode: z.enum(['final', 'maintained', 'deadline', 'accumulated']),
    deadline_seconds: finite.nonnegative().nullable(),
  })
  .strict()
export const parametersSchema = z
  .object({
    weather_severity: percentage,
    environmental_disruption: percentage,
    team_count: finite.int('Team count must be an integer.').min(1).max(10),
    equipment_reliability: percentage,
    resource_level: percentage,
    communication_reliability: percentage,
    backup_power_enabled: z.boolean(),
    custom_metadata: z.record(
      z.union([z.string(), z.boolean(), finite, z.null()]),
    ),
  })
  .strict()
export const configurationSchema = z
  .object({
    id: z.string().uuid(),
    schema_version: z.literal(1),
    name: z.string().trim().min(1, 'Mission name cannot be blank.'),
    description: z.string(),
    category: z.literal('communications_recovery'),
    duration_seconds: finite
      .int('Duration must be an integer number of seconds.')
      .min(60)
      .max(86400),
    parameters: parametersSchema,
    objectives: z.array(objectiveSchema).min(1, 'Add at least one objective.'),
    facilities: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        kind: z.enum(['relay', 'facility', 'power']),
        x: percentage,
        y: percentage,
        status: z.enum(['operational', 'degraded', 'offline']),
      }),
    ),
    support_teams: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        x: percentage,
        y: percentage,
        status: z.enum(['available', 'responding']),
      }),
    ),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()

export type MissionDraft = MissionConfiguration & { metadata_text: string }

export function parseMetadata(text: string): Record<string, Scalar> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Metadata must be a valid JSON object.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Metadata must be a JSON object with scalar values.')
  for (const scalar of Object.values(value)) {
    if (
      scalar !== null &&
      !['string', 'number', 'boolean'].includes(typeof scalar)
    )
      throw new Error(
        'Metadata accepts only strings, booleans, finite numbers, and null; no arrays or nested objects.',
      )
    if (typeof scalar === 'number' && !Number.isFinite(scalar))
      throw new Error('Metadata numbers must be finite.')
  }
  return value as Record<string, Scalar>
}

function refineMission(
  mission: MissionConfiguration,
  registry: Registry,
  ctx: z.RefinementCtx,
) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  if (!mission.objectives.some((o) => o.required))
    issue(['objectives'], 'At least one objective must be required.')
  for (const [key, list] of [
    ['objectives', mission.objectives],
    ['facilities', mission.facilities],
    ['support_teams', mission.support_teams],
  ] as const) {
    if (new Set(list.map((v) => v.id)).size !== list.length)
      issue([key], 'IDs must be distinct.')
  }
  if (
    mission.support_teams.length &&
    mission.support_teams.length !== mission.parameters.team_count
  )
    issue(['support_teams'], 'Team count must match the configured teams.')
  mission.objectives.forEach((objective, index) => {
    const metric = registry.metrics[objective.metric_key]
    const path = ['objectives', index]
    if (!metric) {
      issue([...path, 'metric_key'], 'Metric is unavailable.')
      return
    }
    if (!metric.operators.includes(objective.operator))
      issue([...path, 'operator'], 'Operator is unsupported for this metric.')
    if (!metric.supported_modes.includes(objective.evaluation_mode))
      issue(
        [...path, 'evaluation_mode'],
        'Mode is unsupported for this metric.',
      )
    if (
      objective.target_value < metric.minimum ||
      (metric.maximum !== null && objective.target_value > metric.maximum)
    )
      issue(
        [...path, 'target_value'],
        `Threshold must be ${metric.minimum}..${metric.maximum ?? 'unbounded'} ${metric.unit}.`,
      )
    if (
      metric.value_type === 'integer' &&
      !Number.isInteger(objective.target_value)
    )
      issue([...path, 'target_value'], 'Count thresholds must be integers.')
    if (objective.evaluation_mode === 'deadline') {
      if (objective.deadline_seconds === null)
        issue(
          [...path, 'deadline_seconds'],
          'Deadline mode requires a deadline.',
        )
      else if (objective.deadline_seconds > mission.duration_seconds)
        issue(
          [...path, 'deadline_seconds'],
          'Deadline cannot exceed mission duration.',
        )
    } else if (objective.deadline_seconds !== null)
      issue(
        [...path, 'deadline_seconds'],
        'Only deadline mode accepts a deadline.',
      )
  })
}

export function missionSchema(registry: Registry) {
  return configurationSchema.superRefine((mission, ctx) =>
    refineMission(mission, registry, ctx),
  )
}
export function draftSchema(registry: Registry) {
  return configurationSchema
    .extend({ metadata_text: z.string() })
    .superRefine((draft, ctx) => {
      const regenerated = { ...draft, support_teams: [] }
      refineMission(regenerated, registry, ctx)
      try {
        parseMetadata(draft.metadata_text)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata_text'],
          message: (error as Error).message,
        })
      }
    })
}

export function toDraft(mission: MissionConfiguration): MissionDraft {
  return {
    ...structuredClone(mission),
    metadata_text: JSON.stringify(mission.parameters.custom_metadata, null, 2),
  }
}
export function serializeDraft(
  draft: MissionDraft,
  originalTeamCount?: number,
): MissionConfiguration {
  const { metadata_text, ...mission } = structuredClone(draft)
  mission.parameters.custom_metadata = parseMetadata(metadata_text)
  mission.objectives = mission.objectives.map((objective) => ({
    ...objective,
    name: objective.name.trim(),
    deadline_seconds:
      objective.evaluation_mode === 'deadline'
        ? objective.deadline_seconds
        : null,
  }))
  if (
    originalTeamCount !== undefined &&
    originalTeamCount !== mission.parameters.team_count
  )
    mission.support_teams = []
  mission.name = mission.name.trim()
  return mission
}
