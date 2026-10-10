import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { useConfirm } from '../../components/ui/confirmation'
export function useDirtyGuard(dirty: boolean) {
  const allowed = useRef(false),
    asking = useRef(false)
  const confirm = useConfirm()
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowed.current &&
      currentLocation.pathname + currentLocation.search !==
        nextLocation.pathname + nextLocation.search,
  )
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return
    asking.current = true
    void confirm({
      title: 'Discard unsaved changes?',
      description: 'Your draft has not been saved to the backend.',
      confirmText: 'Discard changes',
    }).then((yes) => {
      if (yes) blocker.proceed()
      else blocker.reset()
      asking.current = false
    })
  }, [blocker, confirm])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty && !allowed.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  return () => {
    allowed.current = true
    queueMicrotask(() => {
      allowed.current = false
    })
  }
}
