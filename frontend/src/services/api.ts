import type {
  AIEnvelope,
  CommandType,
  Event,
  HistorySample,
  MissionConfiguration,
  MissionObjective,
  MissionState,
  Preferences,
  Provider,
  ProviderStatus,
  Readiness,
  RecoveryPlan,
  Registry,
  Report,
  Settings,
} from '../types/mission'

export interface ValidationDetail {
  loc: (string | number)[]
  msg: string
  type?: string
}
export class ApiError extends Error {
  readonly status: number
  readonly fields: ValidationDetail[]
  readonly retryAfter: number
  readonly outcomeUnknown: boolean
  constructor(
    message: string,
    status = 0,
    fields: ValidationDetail[] = [],
    retryAfter = 0,
    outcomeUnknown = false,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
    this.retryAfter = retryAfter
    this.outcomeUnknown = outcomeUnknown
  }
}
export async function request<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    signal?: AbortSignal
    timeout?: number
  } = {},
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeout ?? 20000)
  try {
    const response = await fetch(
      path.startsWith('/health') || path.startsWith('/ready')
        ? path
        : `/api/v1${path}`,
      {
        method: options.method ?? 'GET',
        signal: controller.signal,
        headers:
          options.body === undefined
            ? undefined
            : { 'Content-Type': 'application/json' },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    )
    if (response.status === 204) return undefined as T
    const text = await response.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new ApiError(
        'The server returned an unreadable response.',
        response.status,
        [],
        0,
        options.method !== undefined && options.method !== 'GET',
      )
    }
    if (!response.ok) {
      const detail = (data as { detail?: string | ValidationDetail[] } | null)
        ?.detail
      const fields = Array.isArray(detail) ? detail : []
      const fallback: Record<number, string> = {
        404: 'This resource no longer exists.',
        409: 'The action conflicts with the current server state.',
        422: 'Some fields are invalid.',
        429: 'Too many requests. Wait before trying again.',
        503: 'This service is unavailable.',
      }
      const message =
        typeof detail === 'string'
          ? detail
          : fields.length
            ? fields
                .map(
                  (f) =>
                    `${f.loc.filter((p) => p !== 'body').join('.')}: ${f.msg}`,
                )
                .join('; ')
            : (fallback[response.status] ??
              `Request failed (${response.status}).`)
      const retry = response.headers.get('Retry-After')
      const retryAfter = retry
        ? Math.max(
            0,
            Number.isFinite(Number(retry))
              ? Number(retry)
              : (Date.parse(retry) - Date.now()) / 1000,
          )
        : 0
      throw new ApiError(
        message,
        response.status,
        fields,
        Number.isFinite(retryAfter) ? retryAfter : 0,
        response.status === 408 || response.status === 504,
      )
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted && !timedOut) throw error
    throw new ApiError(
      timedOut
        ? 'Request timed out. The outcome is unknown; refresh or retry the same action.'
        : 'Cannot reach the backend. The outcome of a submitted action may be unknown.',
      0,
      [],
      0,
      true,
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
const id = encodeURIComponent
export const api = {
  missions: (signal?: AbortSignal) =>
    request<MissionConfiguration[]>('/missions', { signal }),
  mission: (missionId: string, signal?: AbortSignal) =>
    request<MissionConfiguration>(`/missions/${id(missionId)}`, { signal }),
  saveMission: (mission: MissionConfiguration, editing: boolean) =>
    request<MissionConfiguration>(
      editing ? `/missions/${id(mission.id)}` : '/missions',
      { method: editing ? 'PUT' : 'POST', body: mission },
    ),
  deleteMission: (missionId: string) =>
    request<void>(`/missions/${id(missionId)}`, { method: 'DELETE' }),
  objectives: (missionId: string, signal?: AbortSignal) =>
    request<MissionObjective[]>(`/missions/${id(missionId)}/objectives`, {
      signal,
    }),
  addObjective: (missionId: string, objective: MissionObjective) =>
    request<MissionObjective>(`/missions/${id(missionId)}/objectives`, {
      method: 'POST',
      body: objective,
    }),
  updateObjective: (objective: MissionObjective) =>
    request<MissionObjective>(`/objectives/${id(objective.id)}`, {
      method: 'PUT',
      body: objective,
    }),
  deleteObjective: (objectiveId: string) =>
    request<void>(`/objectives/${id(objectiveId)}`, { method: 'DELETE' }),
  runs: (signal?: AbortSignal) =>
    request<MissionState[]>('/simulations', { signal }),
  run: (runId: string, signal?: AbortSignal) =>
    request<MissionState>(`/simulations/${id(runId)}`, { signal }),
  createRun: (
    mission_id: string,
    random_seed: number,
    time_multiplier: number,
  ) =>
    request<MissionState>('/simulations', {
      method: 'POST',
      body: { mission_id, random_seed, time_multiplier },
    }),
  createDemo: () =>
    request<MissionState>('/simulations/demo', { method: 'POST' }),
  recoveryPlan: (runId: string, signal?: AbortSignal) =>
    request<RecoveryPlan>(`/simulations/${id(runId)}/recovery-plan`, { signal }),
  command: (
    runId: string,
    body: {
      command_type: CommandType
      payload: Readonly<Record<string, unknown>>
      idempotency_key: string
    },
  ) =>
    request<MissionState>(`/simulations/${id(runId)}/commands`, {
      method: 'POST',
      body,
    }),
  reset: (runId: string, idempotency_key: string) =>
    request<MissionState>(`/simulations/${id(runId)}/reset`, {
      method: 'POST',
      body: { idempotency_key },
    }),
  events: (runId: string, signal?: AbortSignal) =>
    request<Event[]>(`/simulations/${id(runId)}/events`, { signal }),
  telemetry: (
    runId: string,
    from?: number,
    to?: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams()
    if (from !== undefined) params.set('from_seconds', String(from))
    if (to !== undefined) params.set('to_seconds', String(to))
    return request<HistorySample[]>(
      `/simulations/${id(runId)}/telemetry?${params}`,
      { signal },
    )
  },
  reports: (signal?: AbortSignal) => request<Report[]>('/reports', { signal }),
  report: (runId: string, signal?: AbortSignal) =>
    request<Report>(`/reports/${id(runId)}`, { signal }),
  registry: (signal?: AbortSignal) =>
    request<Registry>('/registry', { signal }),
  settings: (signal?: AbortSignal) =>
    request<Settings>('/settings', { signal }),
  saveSettings: (body: Preferences) =>
    request<Settings>('/settings', { method: 'PUT', body }),
  providers: (signal?: AbortSignal) =>
    request<ProviderStatus[]>('/ai/providers/status', { signal }),
  health: (signal?: AbortSignal) =>
    request<{ status: string }>('/health', { signal }),
  readiness: (signal?: AbortSignal) => request<Readiness>('/ready', { signal }),
  ai: <T>(
    task: string,
    body: {
      prompt?: string
      message?: string
      mission_id?: string
      run_id?: string
      incident_id?: string
      provider?: Provider
    },
  ) =>
    request<AIEnvelope<T>>(`/ai/${task}`, {
      method: 'POST',
      body,
      timeout: 120000,
    }),
}
