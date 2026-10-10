import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  facilitySystem,
  facilityType,
} from '../../features/control/presentation'
import type { MissionState } from '../../types/mission'
import { isTerminal } from '../../types/mission'
import { simulationClock, number } from '../../utils/format'

export default function OperationsSummary({ state }: { state: MissionState }) {
  const [filter, setFilter] = useState('all')
  const events = state.events
    .filter((e) => filter === 'all' || e.severity === filter)
    .slice(-5)
    .reverse()
  return (
    <div className="operations-summary" data-testid="operations-summary">
      <section className="summary-activity">
        <div className="summary-heading">
          <h2>Activity log</h2>
          <a className="summary-link" href="#full-event-history">
            Full event history
          </a>
          <select
            aria-label="Activity filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All events</option>
            <option value="warning">Warnings</option>
            <option value="critical">Critical</option>
            <option value="action">Actions</option>
            <option value="info">Information</option>
          </select>
        </div>
        <ol>
          {events.map((e) => (
            <li key={e.id}>
              <time>{simulationClock(e.simulated_time_seconds)}</time>
              <i className={`event-dot severity-${e.severity}`} />
              <span title={e.message}>{e.message}</span>
            </li>
          ))}
        </ol>
        {!events.length && (
          <p className="cg-help">No matching events recorded.</p>
        )}
      </section>
      <section className="summary-facilities">
        <div className="summary-heading">
          <h2>Facility summary</h2>
          <span>Associated system health</span>
        </div>
        <div className="cg-table-wrap">
          <table className="cg-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Type</th>
                <th>Status</th>
                <th>System health</th>
              </tr>
            </thead>
            <tbody>
              {state.facilities.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{facilityType[f.kind]}</td>
                  <td>
                    <span className={`status-text status-${f.status}`}>
                      {f.status}
                    </span>
                  </td>
                  <td>
                    <span className="table-health">
                      <span
                        className={`mini-meter tone-${f.status === 'offline' ? 'red' : f.status === 'degraded' ? 'amber' : 'green'}`}
                      >
                        <i
                          style={{
                            width: `${state.systems[facilitySystem[f.kind]]}%`,
                          }}
                        />
                      </span>
                      {number(state.systems[facilitySystem[f.kind]], '%')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="summary-metrics">
        <div className="summary-heading">
          <h2>Run metrics</h2>
        </div>
        <dl>
          {[
            [
              'Unresolved',
              state.incidents.filter((i) => i.status !== 'resolved').length,
              '',
            ],
            ['Incidents resolved', state.metrics.incidents_resolved, ''],
            ['Systems restored', state.metrics.systems_restored, ''],
            [
              'Supplies delivered',
              state.metrics.supplies_delivered_percent,
              '%',
            ],
          ].map(([label, value, unit]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{number(Number(value), String(unit))}</dd>
            </div>
          ))}
        </dl>
        <Link
          className="summary-link"
          to={
            isTerminal(state.status) ? `/reports/${state.run_id}` : '/reports'
          }
        >
          Browse report evidence
        </Link>
      </section>
    </div>
  )
}
