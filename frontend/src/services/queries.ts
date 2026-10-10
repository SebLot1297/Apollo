import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { MissionConfiguration, MissionState } from '../types/mission'
import { isTerminal } from '../types/mission'
import { api } from './api'
import { acceptState, parseState } from './state'

export const keys = {
  missions: ['missions'] as const,
  mission: (id: string) => ['mission', id] as const,
  objectives: (id: string) => ['objectives', id] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['report', id] as const,
  registry: ['registry'] as const,
  settings: ['settings'] as const,
  providers: ['providers'] as const,
  readiness: ['readiness'] as const,
  health: ['health'] as const,
}

export function latestState(
  client: QueryClient,
  runId: string,
  current?: MissionState,
) {
  const cached = client.getQueryData<MissionState>(keys.run(runId))
  const listed = client
    .getQueryData<MissionState[]>(keys.runs)
    ?.find((run) => run.run_id === runId)
  return [current, cached, listed].reduce<MissionState | undefined>(
    (newest, state) =>
      state && (!newest || state.sequence > newest.sequence) ? state : newest,
    undefined,
  )
}

export function cacheState(
  client: QueryClient,
  runId: string,
  incoming: unknown,
) {
  client.setQueryData<MissionState>(keys.run(runId), (current) =>
    acceptState(latestState(client, runId, current), incoming, runId),
  )
  const accepted = client.getQueryData<MissionState>(keys.run(runId))
  if (accepted)
    client.setQueryData<MissionState[]>(keys.runs, (current) =>
      current?.map((run) =>
        run.run_id === runId ? acceptState(run, accepted, runId)! : run,
      ),
    )
  if (accepted && isTerminal(accepted.status)) terminalQueries(client, runId)
  return accepted
}
export function terminalQueries(client: QueryClient, runId: string) {
  // Avoid a terminal polling/refetch loop; mark the corresponding terminal sequence once.
  const state = client.getQueryData<MissionState>(keys.run(runId))
  const marker = ['terminal-observed', runId] as const
  if (state && client.getQueryData<number>(marker) === state.sequence) return
  if (state) client.setQueryData(marker, state.sequence)
  void client.invalidateQueries({ queryKey: keys.runs })
  void client.invalidateQueries({ queryKey: keys.reports })
  void client.invalidateQueries({ queryKey: keys.report(runId) })
}
export const invalidateMission = (client: QueryClient, missionId: string) =>
  Promise.all([
    client.invalidateQueries({ queryKey: keys.missions }),
    client.invalidateQueries({ queryKey: keys.mission(missionId) }),
    client.invalidateQueries({ queryKey: keys.objectives(missionId) }),
  ])
export async function cacheMission(
  client: QueryClient,
  mission: MissionConfiguration,
) {
  // A read started before Save must not replace the confirmed write response.
  await Promise.all([
    client.cancelQueries({ queryKey: keys.missions }),
    client.cancelQueries({ queryKey: keys.mission(mission.id) }),
    client.cancelQueries({ queryKey: keys.objectives(mission.id) }),
  ])
  client.setQueryData(keys.mission(mission.id), mission)
  client.setQueryData(keys.objectives(mission.id), mission.objectives)
  client.setQueryData<MissionConfiguration[]>(
    keys.missions,
    (current) =>
      current && [mission, ...current.filter((item) => item.id !== mission.id)],
  )
  // Library refresh is independent of whether the write succeeded.
  void client.invalidateQueries({ queryKey: keys.missions })
}
export function runOptions(runId: string, client: QueryClient) {
  return {
    queryKey: keys.run(runId),
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      parseState(await api.run(runId, signal), runId),
    structuralSharing: (old: unknown, incoming: unknown) => {
      return acceptState(
        latestState(client, runId, old as MissionState | undefined),
        incoming,
        runId,
      )
    },
    gcTime: Infinity,
    staleTime: 2000,
    enabled: Boolean(runId),
  }
}
export const useRun = (runId: string, client: QueryClient) =>
  useQuery(runOptions(runId, client))
export const useMissions = () =>
  useQuery({
    queryKey: keys.missions,
    queryFn: ({ signal }) => api.missions(signal),
  })
export const useMission = (id: string) =>
  useQuery({
    queryKey: keys.mission(id),
    queryFn: ({ signal }) => api.mission(id, signal),
    enabled: Boolean(id),
  })
export const useObjectives = (id: string) =>
  useQuery({
    queryKey: keys.objectives(id),
    queryFn: ({ signal }) => api.objectives(id, signal),
    enabled: Boolean(id),
  })
export function useRuns(client: QueryClient) {
  return useQuery({
    queryKey: keys.runs,
    queryFn: async ({ signal }) =>
      (await api.runs(signal)).map((run) => parseState(run)),
    structuralSharing: (old: unknown, incoming: unknown) =>
      (incoming as MissionState[]).map((run) => {
        const cached = client.getQueryData<MissionState>(keys.run(run.run_id))
        const listed = (old as MissionState[] | undefined)?.find(
          (item) => item.run_id === run.run_id,
        )
        const current =
          cached && (!listed || cached.sequence >= listed.sequence)
            ? cached
            : listed
        return acceptState(current, run, run.run_id)!
      }),
    refetchInterval: 10000,
  })
}
export const useReports = () =>
  useQuery({
    queryKey: keys.reports,
    queryFn: ({ signal }) => api.reports(signal),
  })
export const useReport = (id: string) =>
  useQuery({
    queryKey: keys.report(id),
    queryFn: ({ signal }) => api.report(id, signal),
    enabled: Boolean(id),
  })
export const useRegistry = () =>
  useQuery({
    queryKey: keys.registry,
    queryFn: ({ signal }) => api.registry(signal),
    staleTime: 60000,
  })
export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => api.settings(signal),
  })
export const useProviders = () =>
  useQuery({
    queryKey: keys.providers,
    queryFn: ({ signal }) => api.providers(signal),
    staleTime: 30000,
  })
export const useReadiness = () =>
  useQuery({
    queryKey: keys.readiness,
    queryFn: ({ signal }) => api.readiness(signal),
    refetchInterval: 30000,
  })
