import { Circle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'cyan'
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <Circle size={5} fill="currentColor" />
      {children}
    </span>
  )
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  )
}
export function PanelTitle({
  title,
  meta,
  icon: Icon,
}: {
  title: string
  meta?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="panel-title">
      <h2>
        {Icon && <Icon size={16} />}
        {title}
      </h2>
      {meta && <span className="panel-meta">{meta}</span>}
    </div>
  )
}
