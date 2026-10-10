import { useState } from 'react'
import type { AIEnvelope, Incident } from '../../types/mission'
import { useAI } from './useAI'
import Availability from './Availability'
import Provenance from './Provenance'

export default function Assistant({
  runId,
  incident,
}: {
  runId: string
  incident?: Incident
}) {
  const ai = useAI(),
    [message, setMessage] = useState(''),
    [responses, setResponses] = useState<AIEnvelope[]>([])
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
