import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../store/workspace'
import { api } from './api'
import { backendUrl } from './backend'
import { cacheState, latestState, terminalQueries } from './queries'
import { parseFrame } from './state'

interface Session {
  subscribers: number
  dispose: () => void
}
const clients = new WeakMap<QueryClient, Map<string, Session>>()

export function subscribeRun(client: QueryClient, runId: string) {
  let sessions = clients.get(client)
  if (!sessions) {
    sessions = new Map()
    clients.set(client, sessions)
  }
  let session = sessions.get(runId)
  if (!session) {
    let active = true,
      live = false,
      attempt = 0,
      socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined
    let pollAbort: AbortController | null = null
    const connection = (
      status: 'connecting' | 'live' | 'reconnecting' | 'offline',
    ) => {
      if (active) useWorkspace.getState().setConnection(runId, status)
    }
    const poll = async () => {
      if (!active) return
      if (!live && !pollAbort) {
        pollAbort = new AbortController()
        try {
          const state = await api.run(runId, pollAbort.signal)
          if (active) cacheState(client, runId, state)
        } catch {
          /* Query errors and connection status have explicit UI. */
        } finally {
          pollAbort = null
        }
      }
      if (active) pollTimer = setTimeout(poll, 2000)
    }
    const connect = () => {
      if (!active) return
      if (!navigator.onLine) {
        connection('offline')
        reconnectTimer = setTimeout(connect, 5000)
        return
      }
      connection(attempt ? 'reconnecting' : 'connecting')
      const url = backendUrl(
        `/api/v1/simulations/${encodeURIComponent(runId)}/stream`,
      )
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const current = new WebSocket(url)
      socket = current
      snapshotTimer = setTimeout(() => {
        if (active && !live && socket === current) current.close()
      }, 10000)
      current.onmessage = (event) => {
        if (!active || socket !== current) return
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch {
          return
        }
        const frame = parseFrame(raw, runId)
        if (!frame) return
        const existing = latestState(client, runId)
        if (existing && frame.sequence < existing.sequence) return
        // Equal snapshots confirm liveness but never replace cached state.
        if (frame.type === 'snapshot' || live) {
          live = true
          attempt = 0
          clearTimeout(snapshotTimer)
          connection('live')
        }
        cacheState(client, runId, frame.state)
        if (frame.type === 'completion') terminalQueries(client, runId)
      }
      current.onerror = () => {
        /* onclose owns reconnect scheduling. */
      }
      current.onclose = () => {
        if (!active || socket !== current) return
        live = false
        clearTimeout(snapshotTimer)
        attempt += 1
        connection(
          attempt >= 5 || !navigator.onLine ? 'offline' : 'reconnecting',
        )
        const delay = Math.min(
          15000,
          500 * 2 ** Math.min(attempt - 1, 5) * (0.85 + Math.random() * 0.3),
        )
        reconnectTimer = setTimeout(connect, delay)
      }
    }
    session = {
      subscribers: 0,
      dispose: () => {
        active = false
        clearTimeout(reconnectTimer)
        clearTimeout(pollTimer)
        clearTimeout(snapshotTimer)
        pollAbort?.abort()
        socket?.close()
        useWorkspace.getState().setConnection(runId, 'offline')
      },
    }
    sessions.set(runId, session)
    // Strict Mode's synthetic unmount/remount happens before this microtask.
    queueMicrotask(() => {
      if (active && session!.subscribers) {
        connect()
        pollTimer = setTimeout(poll, 1000)
      }
    })
  }
  session.subscribers += 1
  const currentSession = session
  return () => {
    currentSession.subscribers -= 1
    queueMicrotask(() => {
      if (!currentSession.subscribers) {
        currentSession.dispose()
        if (sessions!.get(runId) === currentSession) sessions!.delete(runId)
      }
    })
  }
}
export function useRunStream(client: QueryClient, runId: string) {
  useEffect(
    () => (runId ? subscribeRun(client, runId) : undefined),
    [client, runId],
  )
}
