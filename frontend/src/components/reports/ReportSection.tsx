import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function ReportSection({
  title,
  meta,
  label = title,
  children,
}: {
  title: string
  meta?: ReactNode
  label?: string
  children: ReactNode
}) {
  return (
    <section className="panel" aria-label={label}>
      <details className="report-disclosure">
        <summary>
          <h2 aria-label={title}>
            <ChevronDown size={18} aria-hidden="true" />
            <span>{title}</span>
            {meta && <span className="panel-meta">{meta}</span>}
          </h2>
        </summary>
        {children}
      </details>
    </section>
  )
}
