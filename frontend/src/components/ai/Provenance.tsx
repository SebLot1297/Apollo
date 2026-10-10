import type { AIEnvelope } from '../../types/mission'
import { Badge } from '../ui/Primitives'
export default function Provenance({
  envelope,
}: {
  envelope: AIEnvelope<unknown>
}) {
  return (
    <div className="cg-provenance">
      <Badge
        tone={envelope.mock || envelope.provider === 'mock' ? 'amber' : 'cyan'}
      >
        {envelope.mock || envelope.provider === 'mock'
          ? 'DEMO/MOCK'
          : 'AI response'}
      </Badge>
      <span>Provider: {envelope.provider}</span>
      <span>Model: {envelope.model}</span>
      {envelope.fallback_reason && (
        <span>Fallback: {envelope.fallback_reason}</span>
      )}
      <span>{envelope.latency_ms} ms</span>
    </div>
  )
}
