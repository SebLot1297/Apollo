import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type Confirmation } from './confirmation'
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (Confirmation & { resolve: (yes: boolean) => void }) | null
  >(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((resolve) => {
        trigger.current = document.activeElement as HTMLElement
        setPending((previous) => {
          previous?.resolve(false)
          return { ...options, resolve }
        })
      }),
    [],
  )
  const close = (yes: boolean) => {
    pending?.resolve(yes)
    dialog.current?.close()
    setPending(null)
    trigger.current?.focus()
  }
  useEffect(() => {
    if (pending) dialog.current?.showModal()
    else dialog.current?.close()
  }, [pending])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="cg-dialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              'button:not(:disabled)',
            ),
          )
          const first = buttons[0],
            last = buttons.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        onCancel={(event) => {
          event.preventDefault()
          close(false)
        }}
      >
        {pending && (
          <>
            <h2 id="confirm-title">{pending.title}</h2>
            <p id="confirm-description">{pending.description}</p>
            <div className="cg-actions">
              <button
                type="button"
                className="button"
                autoFocus
                onClick={() => close(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button warning"
                onClick={() => close(true)}
              >
                {pending.confirmText ?? 'Confirm'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext.Provider>
  )
}
