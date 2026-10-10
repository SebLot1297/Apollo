import { useState } from 'react'
import type { AIEnvelope, Incident } from '../../types/mission'
import { useAI } from './useAI'
import Availability from './Availability'
import Provenance from './Provenance'

export default function Assistant({
  runId,
  incident,
  sequence,
}: {
  runId: string
  incident?: Incident
  sequence: number
}) {
  const ai = useAI(),
    [message, setMessage] = useState(''),
    [responses, setResponses] = useState<AIEnvelope[]>([]),
    [strategy, setStrategy] = useState<AIEnvelope | null>(null),
    [strategySequence, setStrategySequence] = useState(0)
  const ask = async (explain: boolean) => {
    const response = await ai.execute<{ text: string }>(
      explain ? 'explain-incident' : 'chat',
      {
        run_id: runId,
        ...(explain ? { incident_id: incident?.id } : { message }),
      },
    )
    if (response && typeof response.data?.text === 'string')
      setResponses((current) => [...current.slice(-9), response])
  }
  const generateStrategy = async () => {
    const response = await ai.execute<{ text: string }>(
      'generate-recovery-strategy',
      { run_id: runId },
    )
    if (response && typeof response.data?.text === 'string') {
      setStrategy(response)
      setStrategySequence(sequence)
    }
  }
  return (
    <section className="panel cg-content cg-ai-panel">
      <h2 className="cg-section-title">Mission assistant</h2>
      <p className="cg-help">
        Optional explanations only. AI cannot send commands or alter trusted
        state.
      </p>
      <Availability ai={ai} />
      <button
        className="button"
        disabled={ai.pending || Boolean(ai.cooldown)}
        title={ai.available ? undefined : 'Live AI is unavailable; recovery controls still work.'}
        onClick={() => void generateStrategy()}
      >
        Generate AI strategy
      </button>
      {strategy && (
        <div className="cg-stack" data-testid="ai-strategy">
          <Provenance envelope={strategy} />
          <p className="cg-ai-text">{strategy.data.text}</p>
          {sequence !== strategySequence && (
            <p className="cg-help" role="status">
              This strategy is outdated after a state change. Regenerate it to
              reflect the latest incidents and actions.
            </p>
          )}
        </div>
      )}
      <button
        className="button"
        disabled={
          !ai.available || ai.pending || Boolean(ai.cooldown) || !incident
        }
        onClick={() => void ask(true)}
      >
        Explain selected incident
      </button>
      <label className="cg-field">
        <span>Assistant message</span>
        <textarea
          value={message}
          maxLength={8000}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <button
        className="button"
        disabled={
          !ai.available ||
          ai.pending ||
          Boolean(ai.cooldown) ||
          !message.trim() ||
          message.length > 8000
        }
        onClick={() => void ask(false)}
      >
        Ask assistant
      </button>
      {responses.map((response, index) => (
        <div className="cg-stack" key={index}>
          <Provenance envelope={response} />
          <p className="cg-ai-text">{response.data.text}</p>
        </div>
      ))}
    </section>
  )
}
