import type { AIEnvelope } from '../../types/mission'
import { Badge } from '../ui/Primitives'

const FALLBACK_REASONS: Record<string, string> = {
  upstream_rate_limited: 'provider rate limit or quota reached',
  authentication_failed: 'provider rejected the API key',
  model_or_endpoint_not_found: 'provider model or endpoint not found',
  upstream_unavailable: 'provider temporarily unavailable',
  connection_failed: 'could not reach the provider',
  timeout: 'provider timed out',
  not_configured: 'provider is not configured',
  empty_response: 'provider returned an empty response',
  response_too_large: 'provider response was too large',
  invalid_response: 'provider returned an unexpected response',
  invalid_output: 'provider output failed validation',
  output_token_limit: 'provider hit its output token limit',
  provider_request_failed: 'provider request failed',
  demo_mode: 'demo mode is enabled',
  mock_selected: 'the deterministic provider was selected',
}

const isMockEnvelope = (envelope: AIEnvelope<unknown>) =>
  envelope.mock || envelope.provider === 'mock'

const describeFallback = (reason: string) =>
  reason
    .split('; ')
    .map((part) => {
      const separator = part.indexOf(':')
      if (separator === -1) return FALLBACK_REASONS[part] ?? part
      const provider = part.slice(0, separator)
      const code = part.slice(separator + 1)
      return `${provider}: ${FALLBACK_REASONS[code] ?? code.replaceAll('_', ' ')}`
    })
    .join('; ')

export default function Provenance({
  envelope,
}: {
  envelope: AIEnvelope<unknown>
}) {
  const mock = isMockEnvelope(envelope)
  return (
    <div className="cg-provenance">
      <Badge tone={mock ? 'amber' : 'cyan'}>
        {mock ? 'DEMO/MOCK' : 'AI response'}
      </Badge>
      <span>Provider: {envelope.provider}</span>
      <span>Model: {envelope.model}</span>
      {envelope.fallback_reason && (
        <span>
          {`${mock ? 'Deterministic output' : 'Fallback'} (${describeFallback(
            envelope.fallback_reason,
          )})`}
        </span>
      )}
      <span>{envelope.latency_ms} ms</span>
    </div>
  )
}
