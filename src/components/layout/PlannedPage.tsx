import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, PageHeading, PanelTitle } from '../ui/Primitives'
export default function PlannedPage({
  title,
  description,
  phase,
  icon: Icon,
  items,
}: {
  title: string
  description: string
  phase: string
  icon: LucideIcon
  items: string[]
}) {
  return (
    <div className="page">
      <PageHeading
        eyebrow="WORKSPACE FOUNDATION"
        title={title}
        description={description}
      >
        <Badge tone="amber">PLANNED · {phase}</Badge>
      </PageHeading>
      <section className="panel planned-page">
        <div className="planned-page-icon">
          <Icon size={32} />
        </div>
        <h2>This workspace is taking shape.</h2>
        <p>
          The application shell is ready. This screen's functionality is
          reserved for a later implementation phase.
        </p>
        <PanelTitle title="Planned capabilities" />
        <ul>
          {items.map((item) => (
            <li key={item}>
              <span className="inactive-dot" />
              {item}
            </li>
          ))}
        </ul>
        <Link className="button" to="/">
          <ArrowLeft size={15} />
          Back to dashboard
        </Link>
      </section>
    </div>
  )
}
