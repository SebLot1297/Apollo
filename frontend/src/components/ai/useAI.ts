import { useEffect, useRef, useState } from 'react'
import type { Provider } from '../../types/mission'
import { api, ApiError } from '../../services/api'
import { useProviders, useSettings } from '../../services/queries'
export function useAI() {
  const providers = useProviders(),
    settings = useSettings()
  const [override, setProvider] = useState<Provider | undefined>(),
    [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null),
    [cooldown, setCooldown] = useState(0)
  const busy = useRef(false)
  const provider = override ?? settings.data?.ai_provider ?? 'auto'
  const available = Boolean(
    providers.data?.some(
      (status) =>
        status.available &&
        (provider === 'auto' || status.provider === provider),
    ),
  )
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(
      () => setCooldown(0),
      Math.max(0, cooldown - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [cooldown])
  const execute = async <T>(
    task: string,
    body: Parameters<typeof api.ai>[1],
  ) => {
    if (busy.current || !available || cooldown > Date.now()) return null
    busy.current = true
    setPending(true)
    setError(null)
    try {
      return await api.ai<T>(task, { ...body, provider })
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.retryAfter)
        setCooldown(Date.now() + failure.retryAfter * 1000)
      return null
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return {
    providers,
    provider,
    setProvider,
    pending,
    error,
    setError,
    cooldown,
    available,
    execute,
  }
}
