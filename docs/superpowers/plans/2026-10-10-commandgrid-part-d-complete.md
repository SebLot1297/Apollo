# CommandGrid — Part D: complete AI and inference implementation prompt

> Use Superpowers executing-plans and test-driven-development. Work through each task, verify its acceptance criteria, and report actual evidence. This is a standalone assignment for the Part D coding agent.

## Objective and scope

Implement optional AI assistance on the integrated Part A API and Part B deterministic simulator: mission proposals, objective proposals, incident explanations, chat about a run, and after-action narratives. Implement Gemini and authenticated Qwen adapters, deterministic mock fallback, provider status, bounded context and resilient orchestration. Prepare reproducible Vultr/vLLM deployment files without provisioning cloud resources or running paid inference.

Only Communications Recovery is enabled. Use fictional infrastructure and disaster-support scenarios. AI creates editable proposals and explanatory text. The numerical engine remains the authority for all metrics, objective outcomes, commands and report success. Every inference is an explicit API request; never invoke models inside a simulation tick or startup inference probe.

## Starting point and ownership

Read `docs/api-contract.md`, `backend/app/schemas/mission.py`, `backend/app/core/config.py`, `backend/app/main.py`, and `backend/app/services/reports/ai_gateway.py`. A already mounts the five AI endpoints, loads `app.services.ai.service.AIService(settings)`, adds rate/concurrency limits, validates envelopes, audits requests, and saves report analysis separately. B supplies domain validation. C will consume these APIs later; frontend integration is outside this assignment.

Own `backend/app/services/ai/**`, `backend/tests/test_ai.py`, `infrastructure/vultr/**`, `docs/ai-providers.md`, and this plan. Reuse the existing AI drafts only after reviewing and testing them. Do not modify unfinished Part C files or replace the simulator. Coordinate any essential changes to shared config, dependencies, audit persistence or routes. Use a `codex/` branch and keep commits scoped. Never store real credentials in Git or responses. Do not create paid resources.

## Required public interfaces

```python
AIService(config=None, *, providers=None)
await service.execute(task, prompt, context=None, provider=None, demo_mode=False)
await service.status()
await service.aclose()
```

Configuration accepts application Settings, an explicit mapping, or environment variables. Provider injection supports offline tests. Provider adapters expose `name`, `model`, `configured`, async `generate_structured(system, prompt, schema, max_tokens)`, `generate_text(system, prompt, max_tokens)`, `health_check()`, and `aclose()`. Provider results contain text and known nonnegative integer token counts only. Provider failures expose fixed codes and a retryable flag, never upstream bodies or credentials.

Successful envelopes have exactly these fields:

```json
{
  "provider": "mock",
  "model": "deterministic-demo-v1",
  "mock": true,
  "fallback_reason": "gemini:not_configured; qwen:not_configured",
  "data": {"text": "Deterministic demo explanation (no live AI model)."},
  "usage": {},
  "latency_ms": 1.0
}
```

`data` is a mission object for `generate_mission`, a plain objective array for `generate_objectives`, or `{text: string}` for other tasks. Provider/model/provenance must identify the actual successful provider. Mock must never impersonate live output. Unknown cost and token usage remain unknown; do not fabricate them.

## D1 — Configuration, adapters and schema validation

1. Validate finite timeout/cache settings, integer token/concurrency/rate settings and supported provider choices. Repr and errors must exclude credentials.
2. Gemini uses the installed official `google-genai` async SDK. Read backend-only `GEMINI_API_KEY` and `GEMINI_MODEL`; the verified requested default is `gemini-3.8-flash`. Use JSON schema output for proposals. Disable SDK retries so service-level retry budgets control the deadline. Reject empty or truncated output and bound response text.
3. Qwen uses `httpx.AsyncClient` with authenticated OpenAI-compatible `/v1/chat/completions` and `/v1/models`. Backend-only settings are `ENABLE_QWEN`, `QWEN_BASE_URL`, `QWEN_API_KEY`, `QWEN_MODEL`; the requested model is `Qwen/Qwen3.8-27B`. Accept TLS or explicit private/loopback HTTP; reject URL credentials, query strings, fragments and malformed ports. Do not follow redirects with authorization headers. Bound response bytes and timeout.
4. Use non-thinking Qwen chat requests and JSON schema `response_format` for proposals. Reject malformed choices, blank responses and token-limit truncation. Normalize only documented usage fields.
5. Parse strict JSON: reject duplicate keys, nonfinite constants, excessive depth/size and invalid schema. Validate missions and every objective against B's Pydantic models. Bound proposal counts and string lengths. For objective additions, validate combined mission objectives, deadlines and IDs against the existing full mission context.
6. Implement deterministic mock templates and recorded-state explanations. Templates explicitly say they do not interpret the prompt. IDs are deterministic for the supplied context and do not collide with existing objective IDs. Explanations use supplied observations and do not invent success probabilities or execute commands.

Acceptance: adapter tests verify actual request shapes and error mapping through injected SDK clients and HTTP transports. Valid proposals pass B schemas; invalid JSON/schema causes alternate-provider or labeled mock fallback.

## D2 — Orchestration, prompts and bounded context

1. Auto routing: Gemini first for mission/objective/report; Qwen first for incident/chat. Honor explicit provider selection and configured primary override. Attempt the alternate configured live provider after failure, then mock. Disabled Qwen is never invoked. Explicit mock and demo mode bypass live providers entirely. `ENABLE_AI=false` returns the existing unavailable error, including in demo mode.
2. Keep instructions separate from serialized user/context data. Prompts specify the task, enabled category, supported metrics and objective rules. Treat descriptions, event text and user content as untrusted data; prohibit claims that commands ran or numeric outcomes changed.
3. Whitelist relevant mission, run, metrics, objectives, systems, incident, event, command and report fields. Exclude credentials, custom metadata, native snapshots and arbitrary payloads. Limit nesting, list lengths and per-string size; take the latest events/commands and compact recent telemetry. Ensure the serialized context fits a strict total budget while preserving numeric facts when retained. Do not mutate input objects.
4. Report narratives receive recorded evaluator outcomes and final metrics. Returned text is separate analysis; never merge model numbers into report state or save configuration automatically. Passing a malicious text instruction cannot grant access to a store, command runner or executable expression.
5. Validate task, nonblank required prompts, input bounds and provider selection before inference. Reject invalid direct service calls predictably.

Acceptance: routing tests cover all five tasks and overrides. A API integration tests prove proposals are not saved and report analysis preserves final metrics, objective outcomes and command records.

## D3 — Deadlines, limits, status and lifecycle

1. Service callers outside A also receive request/minute and concurrency protection. Include queue time in the service deadline. Cap live work below A's overall timeout so fallback has time to complete.
2. Retry transient timeout/connection/429/5xx failures at most once with bounded backoff. Never retry auth failure, invalid schema, malformed response or unsupported endpoint. Allocate bounded time among primary, retry and alternate calls; on timeout cancel provider work and fall back honestly. Never run background orphan inference calls.
3. Return fixed failure codes in fallback reasons; omit exception messages, response bodies and endpoint credentials. Cleanup closes each provider even if another fails. Closed service rejects further use.
4. Cache health checks for the configured interval and coalesce concurrent status reads. Bound each probe. Unconfigured/disabled providers have false availability and truthful details. Metadata reachability means the model is listed/readable; it does not prove inference capacity, remaining quota or successful generation. Status must make that limitation explicit. Mock is locally available when AI is enabled.
5. Success audits remain A's responsibility; service supplies sanitized usage/provenance. Failure errors use A's fixed unavailable/HTTP contracts. Do not invent pricing. Never log prompts, context, headers, keys or full upstream exceptions.

Acceptance: tests cover timeout, retry exhaustion, auth failure, rate rejection, concurrency maximum, queue cancellation, health cache/coalescing, cleanup and secret exclusion.

## D4 — Secured Vultr/vLLM preparation

1. Verify dated official model cards, vLLM Qwen recipe, structured-output documentation, security guidance and Vultr SSH/network documentation. Retain the requested model only if available. Pin an exact model revision and configurable versioned image; validate the selected release compatibility or clearly state the remaining runtime qualification.
2. Supply Compose, env example, authenticated local smoke script and operating instructions. Require a nonempty API key. Bind the host port to loopback, prefer SSH forwarding and keep internal distributed ports private. vLLM auth protects selected API paths; firewall/loopback isolation must also cover unauthenticated ancillary routes.
3. Default to an 8K context, low concurrent sequences and explicit GPU memory utilization. Document weight memory arithmetic separately from runtime/KV/vision overhead. A dense 27B BF16 model needs roughly 54 GB decimal for weights alone; 24 GB is unsuitable without a separately validated quantized model. Choose hardware after measuring actual fit; do not promise a GPU capacity or performance result.
4. Include driver/container prerequisites, preflight validation, model/cache persistence, startup health, log handling, SSH tunnel, backend configuration, authorized live text and schema smoke checks, troubleshooting and rollback. Any optional public exposure requires TLS, authentication and restrictive firewalling; public exposure is not the default deployment.
5. Do not run cloud creation, model downloads, container pulls or GPU inference during local implementation. Render Compose and compile/run offline smoke tests only. Clearly mark provisioning, GPU fit, model loading, latency and live inference unverified until authorized infrastructure is used.

Acceptance: Compose renders using synthetic env values and exposes only the loopback host port. Smoke tests use injected/local fake HTTP responses. Examples contain no live secrets.

## D5 — Verification and integration

Write failing tests before implementing the service. Use injected providers, fake Gemini SDK responses, HTTP mock transports and A's test app with isolated temporary storage. Do not require a model key, network or GPU for the normal suite.

Run from the repository root:

```powershell
uv run --project backend --frozen python -m pytest backend/tests/test_ai.py -q
uv run --project backend --frozen python -m pytest backend/tests -q
uv run --project backend --frozen ruff check backend/app/services/ai backend/tests/test_ai.py
```

Also run the full backend suite against the dedicated local Timescale test database when available, and validate the deployment files without starting GPU containers. Integrate only D-owned verified files into the shared checkout. Start the app and verify `/ready`, `/api/v1/settings`, and an explicit mock proposal through HTTP. Existing routes and deterministic engine tests must continue passing.

## D6 — Handoff and completion evidence

Document configuration, routing, fallback codes, input/output/context budgets, retry semantics, health status limitations, provider envelope examples and optional live checks in `docs/ai-providers.md`. Send C the unchanged envelope shapes and proposal-save requirement. Report exact passing checks, live versus mocked verification, unresolved failures and required deployment decisions.

Local completion means the backend AI service works through A, adapters pass contract tests, regression tests pass and deployment artifacts validate. It does not mean Part C has connected the frontend, a Vultr server exists or real inference has been measured. Push only when requested.

## Implementation record — 2026-10-10

- D1–D3 implemented: Gemini/Qwen/mock adapters, validation, five-task routing, bounded context, retries/deadlines/limits, health cache and cleanup.
- D4 artifacts implemented: authenticated loopback Compose, pinned model/tokenizer revision and versioned image, private env template, preflight, smoke script, operating/rollback instructions. 26 offline deployment tests passed; no GPU or cloud operation executed.
- D5 verified: full dedicated Timescale suite passed **127 tests and 194 subtests**, including 67 AI/API/lifecycle tests. Ruff passed for all changed Python code. One installed Gemini SDK deprecation warning remains.
- Coordinator integration fixes: A gateway timeout includes queue admission; A WebSocket cleanup shields task draining, releases subscriptions and tracks replacement receive tasks before awaited sends. Tests reproduced failures before fixes and passed afterward.
- D6 documentation complete in `docs/ai-providers.md`. Frontend wiring belongs to C. Real Gemini/Qwen inference, immutable image digest, GPU fit and performance remain external qualification tasks.
