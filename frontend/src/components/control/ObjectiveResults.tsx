import type { ObjectiveResult } from '../../types/mission'
import { Badge, PanelTitle } from '../ui/Primitives'
import { number } from '../../utils/format'
export default function ObjectiveResults({
  results,
}: {
  results: ObjectiveResult[]
}) {
  return (
    <section className="panel">
      <PanelTitle title="Objective evidence" />
      <ul className="cg-list">
        {results.map((result) => (
          <li key={result.objective.id} data-testid="objective-result">
            <div className="cg-actions spread">
              <strong>{result.objective.name}</strong>
              <Badge
                tone={
                  result.status === 'passed'
                    ? 'green'
                    : ['failed', 'expired'].includes(result.status)
                      ? 'red'
                      : 'amber'
                }
              >
                {result.status}
              </Badge>
            </div>
            <span>
              {result.objective.required ? 'Required' : 'Optional'} ·{' '}
              {result.objective.evaluation_mode} · {result.objective.metric_key}{' '}
              {result.objective.operator}{' '}
              {number(result.objective.target_value)}
            </span>
            <span>
              Achieved value: {number(result.achieved_value)}
              {result.objective.deadline_seconds !== null
                ? ` · Deadline: ${number(result.objective.deadline_seconds)} seconds`
                : ''}
            </span>
            <span>
              First achievement:{' '}
              {result.first_achieved_at_seconds === null
                ? 'Not achieved'
                : `${number(result.first_achieved_at_seconds)} seconds`}
            </span>
            <p className="cg-help">{result.reason}</p>
          </li>
        ))}
      </ul>
      {!results.length && (
        <p className="cg-empty">
          No objective evidence returned by the server.
        </p>
      )}
    </section>
  )
}
