import { useState } from 'react'
import type { Report } from '../../types/mission'
import { number } from '../../utils/format'
export default function Comparison({ reports }: { reports: Report[] }) {
  const [left, setLeft] = useState(''),
    [right, setRight] = useState('')
  const a = reports.find((r) => r.run_id === left),
    b = reports.find((r) => r.run_id === right)
  const configuration = (report: Report) => ({
    name: report.mission.name,
    category: report.mission.category,
    duration_seconds: report.mission.duration_seconds,
    parameters: report.mission.parameters,
    objectives: report.mission.objectives.map(
      ({ id: _id, ...objective }) => objective,
    ),
    facilities: report.mission.facilities.map(
      ({ id: _id, ...facility }) => facility,
    ),
    support_teams: report.mission.support_teams.map(
      ({ id: _id, ...team }) => team,
    ),
  })
  const differences =
    a && b
      ? Object.keys(configuration(a)).filter(
          (key) =>
            JSON.stringify(
              configuration(a)[key as keyof ReturnType<typeof configuration>],
            ) !==
            JSON.stringify(
              configuration(b)[key as keyof ReturnType<typeof configuration>],
            ),
        )
      : []
  const inputs = (report: Report): Record<string, unknown> => ({
    duration_seconds: report.mission.duration_seconds,
    ...report.mission.parameters,
  })
  return (
    <section className="panel cg-comparison cg-stack">
      <h2 className="cg-section-title">Compare saved reports</h2>
      <div className="cg-grid">
        {[
          ['First report', left, setLeft],
          ['Second report', right, setRight],
        ].map(([label, selected, setter]) => (
          <label className="cg-field" key={label as string}>
            <span>{label as string}</span>
            <select
              aria-label={label as string}
              value={selected as string}
              onChange={(event) =>
                (setter as typeof setLeft)(event.target.value)
              }
            >
              <option value="">Choose report</option>
              {reports.map((report) => (
                <option key={report.run_id} value={report.run_id}>
                  {report.mission.name} · {report.status} ·{' '}
                  {report.run_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {a && b && (
        <>
          <p className="cg-help">
            {a.run_id === b.run_id
              ? 'Select two different reports for a comparison.'
              : differences.length
                ? `Different configurations: ${differences.join(', ')}. These runs are not a controlled experiment.`
                : 'The recorded mission configurations match. Command schedules and seeds can still differ; this is not a controlled experiment.'}
          </p>
          <div className="cg-table-wrap">
            <table className="cg-table">
              <caption>Persisted results supplied by the server</caption>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>First report</th>
                  <th>Second report</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Outcome</td>
                  <td>{a.success ? 'Success' : 'Unsuccessful'}</td>
                  <td>{b.success ? 'Success' : 'Unsuccessful'}</td>
                </tr>
                <tr>
                  <td>Elapsed seconds</td>
                  <td>{number(a.elapsed_time_seconds)}</td>
                  <td>{number(b.elapsed_time_seconds)}</td>
                </tr>
                {Array.from(
                  new Set([
                    ...Object.keys(a.final_metrics),
                    ...Object.keys(b.final_metrics),
                  ]),
                ).map((key) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{number(a.final_metrics[key])}</td>
                    <td>{number(b.final_metrics[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cg-table-wrap">
            <table className="cg-table">
              <caption>Recorded duration and operational parameters</caption>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>First report</th>
                  <th>Second report</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(inputs(a)).map((key) => (
                  <tr key={key}>
                    <td>{key.replaceAll('_', ' ')}</td>
                    <td>{JSON.stringify(inputs(a)[key])}</td>
                    <td>{JSON.stringify(inputs(b)[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
