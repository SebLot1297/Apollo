import type { ReactNode } from 'react'
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  if (!error) return null
  return (
    <div className="cg-notice error" role="alert">
      <strong>{error instanceof Error ? error.message : String(error)}</strong>
      {retry && (
        <button className="button" type="button" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}
export function Loading({
  children = 'Loading server data…',
}: {
  children?: ReactNode
}) {
  return (
    <div className="cg-empty" role="status">
      {children}
    </div>
  )
}
export function Empty({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <section className="panel cg-empty">
      <h2>{title}</h2>
      {children}
    </section>
  )
}
