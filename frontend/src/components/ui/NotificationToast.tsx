import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useNotifications } from '../../store/notifications'

export default function NotificationToast() {
  const notification = useNotifications((state) => state.notification)
  const dismiss = useNotifications((state) => state.dismiss)
  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => dismiss(notification.id), 8000)
    return () => clearTimeout(timer)
  }, [notification, dismiss])
  if (!notification) return null
  return (
    <div
      className="cg-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CheckCircle2 size={22} aria-hidden="true" />
      <span>{notification.message}</span>
      <button
        className="icon-button"
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(notification.id)}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
