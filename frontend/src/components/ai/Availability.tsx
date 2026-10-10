import type { ReturnTypeAI } from './types'
import { ErrorNotice } from '../ui/Feedback'
export default function Availability({ ai }: { ai: ReturnTypeAI }) {
  return (
    <>
      <div className="cg-actions spread">
        <label className="cg-field">
          <span>AI provider</span>
          <select
            value={ai.provider}
            onChange={(event) =>
              ai.setProvider(event.target.value as typeof ai.provider)
            }
          >
            <option value="auto">Automatic</option>
            <option value="gemini">Gemini</option>
            <option value="qwen">Qwen</option>
            <option value="mock">Mock / demo</option>
          </select>
        </label>
        <button
          className="button"
          type="button"
          disabled={ai.providers.isFetching}
          onClick={() => void ai.providers.refetch()}
        >
          Refresh provider status
        </button>
      </div>
      {!ai.available && (
        <p className="cg-help" role="status">
          AI unavailable. Configure and enable an available provider; core
          simulation works without AI.
        </p>
      )}
      {Boolean(ai.cooldown) && (
        <p className="cg-help" role="status">
          Rate limited. Respecting Retry-After before another AI request.
        </p>
      )}
      <ErrorNotice error={ai.error ?? ai.providers.error} />
    </>
  )
}
