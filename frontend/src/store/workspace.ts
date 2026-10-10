import { create } from 'zustand'
import type { ConnectionStatus } from '../types/mission'

interface Workspace {
  selectedRunId: string | null
  selectedIncidentId: string | null
  connections: Record<string, ConnectionStatus>
  pending: Record<string, boolean>
  selectRun: (id: string) => void
  selectIncident: (id: string | null) => void
  setConnection: (id: string, status: ConnectionStatus) => void
  setPending: (id: string, pending: boolean) => void
}
export const useWorkspace = create<Workspace>((set) => ({
  selectedRunId: null,
  selectedIncidentId: null,
  connections: {},
  pending: {},
  selectRun: (id) =>
    set((current) => ({
      selectedRunId: id,
      selectedIncidentId:
        current.selectedRunId === id ? current.selectedIncidentId : null,
    })),
  selectIncident: (id) => set({ selectedIncidentId: id }),
  setConnection: (id, status) =>
    set((current) => ({
      connections: { ...current.connections, [id]: status },
    })),
  setPending: (id, pending) =>
    set((current) => ({ pending: { ...current.pending, [id]: pending } })),
}))
