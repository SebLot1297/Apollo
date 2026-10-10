import { useQueryClient } from '@tanstack/react-query'
import type { Report } from '../../types/mission'
import { keys } from '../../services/queries'
import { useAI } from './useAI'
import Availability from './Availability'
import Provenance from './Provenance'
export default function ReportNarrative({ report }: { report: Report }) {
  const ai = useAI(),
    client = useQueryClient()
  return (
    <section className="panel cg-content cg-ai-panel">
      <h2 className="cg-section-title">Optional AI narrative</h2>
      <p className="cg-help">
        Separate from the server's numerical summary and trusted pass/fail.
      </p>
      <Availability ai={ai} />
      <button
        className="button"
        disabled={!ai.available || ai.pending || Boolean(ai.cooldown)}
        onClick={async () => {
          const response = await ai.execute<{ text: string }>(
            'generate-report',
            { run_id: report.run_id },
          )
          if (response) {
            await client.invalidateQueries({
              queryKey: keys.report(report.run_id),
            })
            await client.invalidateQueries({ queryKey: keys.reports })
          }
        }}
      >
        {ai.pending ? 'Generating narrative…' : 'Generate report narrative'}
      </button>
      {report.ai_analysis ? (
        <>
          <Provenance envelope={report.ai_analysis} />
          <p className="cg-ai-text">{report.ai_analysis.data.text}</p>
        </>
      ) : (
        <p className="cg-help">No AI narrative generated.</p>
      )}
    </section>
  )
}
