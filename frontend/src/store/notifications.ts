import { create } from 'zustand'

interface Notifications {
  notification: { id: string; message: string } | null
  notify: (message: string) => void
  dismiss: (id: string) => void
}

export const useNotifications = create<Notifications>((set) => ({
  notification: null,
  notify: (message) =>
    set({ notification: { id: crypto.randomUUID(), message } }),
  dismiss: (id) =>
    set((current) =>
      current.notification?.id === id ? { notification: null } : current,
    ),
}))
