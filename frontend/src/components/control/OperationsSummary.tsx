import { Link } from 'react-router-dom'
import {
  facilitySystem,
  facilityType,
} from '../../features/control/presentation'
import type { MissionState } from '../../types/mission'
import { isTerminal } from '../../types/mission'
import { elapsed, number } from '../../utils/format'

export default function OperationsSummary({ state }: { state: MissionState }) {
  return (
    <div className="operations-summary" data-testid="operations-summary">
      <section className="summary-context">
        <div className="summary-heading">
          <h2>Mission context</h2>
        </div>
        <p className="cg-help">
          {state.mission.description || 'Infrastructure recovery simulation.'}
        </p>
        <dl className="cg-facts">
          <div>
            <dt>Mission window</dt>
            <dd>{elapsed(state.mission.duration_seconds)}</dd>
          </div>
          <div>
            <dt>Support teams</dt>
            <dd>{state.support_teams.length}</dd>
          </div>
          <div>
            <dt>Recovery</dt>
            <dd>
              {state.recovery_mode === 'automatic' ? 'Automatic' : 'Manual'}
            </dd>
          </div>
        </dl>
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
