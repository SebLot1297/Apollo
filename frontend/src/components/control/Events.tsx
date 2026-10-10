import { useState } from 'react'
import type { Event } from '../../types/mission'
import { Badge, PanelTitle } from '../ui/Primitives'
import { elapsed } from '../../utils/format'
export default function Events({ events }: { events: Event[] }) {
  const [limit, setLimit] = useState(50)
  return (
    <section className="panel">
      <PanelTitle title="Event timeline" meta={`${events.length} recorded`} />
      <ol className="cg-list">
        {events
          .slice(-limit)
          .reverse()
          .map((event) => (
            <li key={event.id}>
              <div className="cg-actions spread">
                <time className="cg-event-time">
                  T+ {elapsed(event.simulated_time_seconds)} · #{event.sequence}
                </time>
                <Badge
                  tone={
                    event.severity === 'critical'
                      ? 'red'
                      : event.severity === 'warning'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {event.event_type.replaceAll('_', ' ')}
                </Badge>
              </div>
              <p>{event.message}</p>
            </li>
          ))}
      </ol>
      {!events.length && <p className="cg-empty">No events recorded.</p>}
      {events.length > limit && (
        <div className="cg-content">
          <button className="button" onClick={() => setLimit(limit + 50)}>
            Show earlier events
          </button>
        </div>
      )}
    </section>
  )
}
