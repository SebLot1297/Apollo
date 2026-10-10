import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { isTerminal, type MissionState } from '../../types/mission'
export function useRecoveryPlan(state: MissionState) {
  const client = useQueryClient()
  const unresolved = state.incidents.filter(
    (i) => i.status !== 'resolved',
  ).length
  const revision = `${state.status}:${unresolved}:${state.recovery_mode ?? 'manual'}`
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['recovery-plan', state.run_id] })
  }, [client, state.run_id, revision])
  return useQuery({
    queryKey: ['recovery-plan', state.run_id],
    queryFn: ({ signal }) => api.recoveryPlan(state.run_id, signal),
    enabled: !isTerminal(state.status) && Boolean(state.run_id),
    refetchInterval: state.status === 'running' ? 5000 : false,
    staleTime: 0,
  })
}
export type RecoveryQuery = ReturnType<typeof useRecoveryPlan>
