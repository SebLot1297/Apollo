import { Link, useParams } from 'react-router-dom'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import { Empty, ErrorNotice, Loading } from '../components/ui/Feedback'
import ObjectiveResults from '../components/control/ObjectiveResults'
import Events from '../components/control/Events'
import Telemetry from '../components/reports/Telemetry'
import Comparison from '../components/reports/Comparison'
import ReportNarrative from '../components/ai/ReportNarrative'
import { useReport, useReports } from '../services/queries'
import { localDate, number } from '../utils/format'
export default function AfterActionReport() {
  const { runId = '' } = useParams(),
    reports = useReports(),
    detail = useReport(runId),
    report = detail.data
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow="PERSISTED EVIDENCE"
        title="After-action reports"
        description="Numerical outcomes and historical snapshots from the backend."
      >
        {runId && (
          <Link className="button" to="/reports">
            All reports
          </Link>
        )}
      </PageHeading>
      <ErrorNotice
        error={runId ? detail.error : reports.error}
        retry={() => void (runId ? detail.refetch() : reports.refetch())}
      />
      {!runId ? (
        reports.isPending ? (
          <Loading />
        ) : (
          <>
            {!reports.data?.length ? (
              <Empty title="No saved reports">
                <p>Finish or terminate a simulation to create a report.</p>
                <Link className="button" to="/mission-control">
                  Open Mission Control
                </Link>
              </Empty>
            ) : (
              <>
                <div className="cg-grid">
                  {reports.data.map((item) => (
                    <article className="panel cg-report-card" key={item.run_id}>
                      <h2 className="cg-section-title">{item.mission.name}</h2>
                      <div className="cg-actions">
                        <Badge tone={item.success ? 'green' : 'red'}>
                          {item.success ? 'Success' : 'Unsuccessful'}
                        </Badge>
                        <span className="cg-help">
                          {item.status} · {number(item.elapsed_time_seconds)}{' '}
                          seconds · {localDate(item.created_at)}
                        </span>
                      </div>
                      <p className="cg-help">{item.summary}</p>
                      <Link className="button" to={`/reports/${item.run_id}`}>
                        Open report {item.run_id.slice(0, 8)}
                      </Link>
                    </article>
                  ))}
                </div>
                <Comparison reports={reports.data} />
              </>
            )}
          </>
        )
      ) : detail.isPending ? (
        <Loading />
      ) : (
        report && (
          <>
            <div className="report-summary">
              <section className="panel cg-content cg-stack">
                <div className="cg-actions spread">
                  <h2 className="cg-section-title">{report.mission.name}</h2>
                  <Badge tone={report.success ? 'green' : 'red'}>
                    {report.success ? 'Success' : 'Unsuccessful'}
                  </Badge>
                </div>
                <p className="cg-help">
                  {report.status} · {number(report.elapsed_time_seconds)}{' '}
                  simulated seconds · {localDate(report.created_at)} · Run{' '}
                  {report.run_id}
                </p>
                <h3>Server numerical summary</h3>
                <p data-testid="numerical-summary">{report.summary}</p>
                <Link
                  className="button"
                  to={`/mission-control/${report.run_id}`}
                >
                  Open historical run / reset
                </Link>
                <details className="cg-details">
                  <summary>Mission configuration snapshot</summary>
                  <dl className="cg-facts">
                    <dt>Duration</dt>
                    <dd>{report.mission.duration_seconds} seconds</dd>
                    {Object.entries(report.mission.parameters).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                  <p className="cg-help">{report.mission.description}</p>
                  <details>
                    <summary>Complete saved configuration JSON</summary>
                    <pre>{JSON.stringify(report.mission, null, 2)}</pre>
                  </details>
                </details>
              </section>
              <section className="panel">
                <PanelTitle title="Final registered metrics" />
                <div className="cg-table-wrap">
                  <table className="cg-table">
                    <caption>
                      Trusted backend values; overall outcome uses
                      report.success.
                    </caption>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Final value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(report.final_metrics).map(
                        ([key, value]) => (
                          <tr key={key}>
                            <td>{key}</td>
                            <td>{number(value)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <ObjectiveResults results={report.objective_results} />
            <Telemetry history={report.telemetry} />
            <Events events={report.events} />
            <section className="panel">
              <PanelTitle title="Accepted command history" />
              <ul className="cg-list">
                {report.command_history.map((command, index) => (
                  <li key={index}>
                    <strong>
                      {command.source === 'automatic' && 'Automatic · '}
                      {command.command_type.replaceAll('_', ' ')} · T+{' '}
                      {number(
                        command.simulated_time_seconds ??
                          command.elapsed_time_seconds,
                      )}
                      s
                    </strong>
                    <p>{command.effect ?? 'Accepted by the backend.'}</p>
                    <span className="cg-help">
                      {JSON.stringify(command.payload)}
                    </span>
                  </li>
                ))}
              </ul>
              {!report.command_history.length && (
                <p className="cg-empty">No accepted commands recorded.</p>
              )}
            </section>
            <ReportNarrative report={report} />
            {reports.data && reports.data.length > 1 && (
              <Comparison reports={reports.data} />
            )}
          </>
        )
      )}
    </div>
  )
}
