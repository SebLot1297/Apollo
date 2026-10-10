# Optional AI assistance

Part D implements the backend AI service used by Part A. Part B's deterministic engine remains independent. Part C must connect the frontend controls; implementing the backend does not automatically make every UI button functional.

## Configuration

Configure backend-only values in the repository `.env` (ignored by Git); never put keys in frontend `VITE_*` variables. Dependencies are already in `backend/pyproject.toml` and the frozen `uv.lock`.

| Variable | Default | Behavior |
| --- | --- | --- |
| `ENABLE_AI` | `true` | False disables all AI, including mock/demo, with HTTP 503. |
| `GEMINI_API_KEY` | empty | Empty key skips Gemini. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Configurable Gemini model ID. |
| `ENABLE_QWEN` | `false` | Explicit opt-in for Qwen. |
| `QWEN_API_KEY` | empty | Required bearer credential; no anonymous inference. |
| `QWEN_BASE_URL` | `http://127.0.0.1:8001/v1` | TLS or explicit loopback/private IP HTTP; no URL credentials, query or fragment. |
| `QWEN_MODEL` | `Qwen/Qwen3.8-27B` | Must match the server's listed model ID. |
| `AI_PRIMARY_PROVIDER` | `auto` | `auto`, `gemini`, `qwen`, `mock`; Settings preferences can override. |
| `DEMO_MODE` | `false` | Forces labeled mock for explicit requests. |
| `AI_TIMEOUT_SECONDS` | `20` | API deadline includes its concurrency queue. |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | 64..8192 per request; raise if full mission output truncates. |
| `AI_MAX_CONCURRENCY` | `2` | 1..8; gateway and standalone service are protected. |
| `AI_REQUESTS_PER_MINUTE` | `12` | 1..120; rejected requests return 429 and `Retry-After: 60`. |
| `AI_HEALTH_CACHE_SECONDS` | `60` | Metadata health cache, 1..3600 seconds. |

No credentials are needed for deterministic mock operation. No inference runs at startup or during ticks. Reading provider status can issue metadata probes when keys are configured; metadata probes do not prove inference quota or capacity.

## Routes, routing and provenance

All routes begin `/api/v1` and return the existing contract envelope `{provider, model, mock, fallback_reason, data, usage, latency_ms}`. `usage` contains only documented nonnegative integer token counts when supplied; costs remain unknown in audit rows.

| POST route | Request | Auto primary | `data` |
| --- | --- | --- | --- |
| `/ai/generate-mission` | `prompt`, optional `provider` | Gemini | Valid mission object |
| `/ai/generate-objectives` | `prompt`, optional `mission_id`, `provider` | Gemini | Plain objective array |
| `/ai/explain-incident` | `run_id`, `incident_id`, optional `provider` | Qwen | `{text: string}` |
| `/ai/chat` | `run_id`, `message`, optional `provider` | Qwen | `{text: string}` |
| `/ai/generate-report` | `run_id`, optional `provider` | Gemini | `{text: string}` |

The requested/configured primary is attempted first; the alternate configured live provider is next; deterministic mock is last. A request with `provider: mock` or demo mode performs no live inference. `ENABLE_QWEN=false` skips Qwen even if a key exists. Missing keys, invalid output and exhausted transient retries produce labeled fallback with fixed reasons such as `gemini:not_configured; qwen:not_configured`, `authentication_failed`, `timeout`, or `invalid_output`. Raw upstream messages and bodies do not enter errors or fallback reasons.

Mission/objective proposals pass Part B validation and remain unsaved until an explicit mission/objective API write. Objective additions must fit the full saved mission's deadlines and IDs. Mock proposals are templates, not interpretations of the request. Their IDs are deterministic and additions avoid existing IDs. Repeating a mission proposal produces the same ID; save a new copy with a new ID if needed.

Report text is persisted as `ai_analysis` in its full provenance envelope. Report success, final metrics, objective results, events and commands stay unchanged. A model can still write inaccurate narrative text; provenance and separate numeric fields let the operator assess it. Prompts cannot enforce factual correctness by themselves. Mock explanations reproduce retained numeric observations without rounding or invented success probabilities.

## Bounds and lifecycle

Prompts are at most 8000 characters. Context is selected from known fields, limited to seven levels, 24 items per general list and 400 characters per string, with bounded traversal. Recent events, commands and incidents use the latest eight entries; telemetry uses the latest three. Serialized context is at most 12000 ASCII JSON characters; whole ancillary fields are dropped to fit, rather than corrupting JSON or rounding numbers. Unknown fields, credentials, custom metadata, event payloads and native snapshots are excluded. Missing facts must remain unknown.

Provider text is at most 64000 characters; Qwen response bodies are at most 262144 bytes. The Gemini SDK receives a request timeout and output-token cap; its completed response text is checked locally, rather than a custom streaming byte cap. Structured proposals reject duplicate keys, nonfinite constants, malformed JSON and invalid schemas. Proposals allow at most 20 new objectives and bounded prose/serialized size. Input objects are not modified.

Standalone service queue plus work uses at most 90% of the configured deadline; live attempts use at most 80%, reserving time for validation/mock. Each live provider gets at most two attempts; only timeout, connection, 429 and 5xx failures retry once with a short bounded backoff. Authentication, schema, malformed-response and endpoint errors do not retry. A's gateway also times its semaphore wait, cancels over-deadline work and audits the resulting failure. Provider clients close during application shutdown; one cleanup failure does not skip other providers.

`GET /ai/providers/status` and Settings return `provider/model/configured/available/detail`. Live `available=true` means a model metadata check succeeded, and the detail explicitly says **inference unverified**. Qwen must list the configured model; Gemini must permit model metadata access. No model generation is used for health. Disabled/unconfigured providers are unavailable. Concurrent status reads share cached probes; callers receive copies of status data.

## Offline and optional live verification

The ordinary test suite requires no model credentials or GPU:

```powershell
uv run --project backend --frozen python -m pytest backend/tests/test_ai.py -q
uv run --project backend --frozen python -m pytest backend/tests -q
uv run --project backend --frozen ruff check backend/app/services/ai backend/tests/test_ai.py backend/app/services/reports/ai_gateway.py
```

Tests inject Gemini SDK clients and Qwen HTTP transports, exercise routing/errors/limits/context, and run actual A APIs with the B engine and isolated DB storage. HTTP integration proves proposals have no save side effects, narrative cannot overwrite numeric reports, and audit cost stays unknown. A separate dedicated Timescale DB can be used through `TEST_DATABASE_URL`; its database name must end in `_test`.

Integration also fixes two existing API lifecycle edges: the gateway deadline now includes semaphore admission, and WebSocket disconnect cleanup shields child-task draining from cancellation after releasing subscriptions. Repeated reconnects are tested with the AI-enabled app.

For a running local app, an explicit mock smoke request is:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/ready
Invoke-RestMethod http://127.0.0.1:8000/api/v1/ai/providers/status
Invoke-RestMethod -Method Post -ContentType application/json -Uri http://127.0.0.1:8000/api/v1/ai/generate-mission -Body '{"prompt":"Fictional communications recovery exercise","provider":"mock"}'
```

Live qualification requires an authorized key/endpoint. Test text and structured proposals, confirm the response's actual provider is the intended live model and `mock=false`, then check usage and audit rows. A 200 response may be mock fallback and is not proof of live inference. Do not log keys, headers or full upstream error responses. GPU deployment and authenticated smoke commands are in `infrastructure/vultr/README.md`.

## Verified primary references

Checked 2026-10-10. Model availability and documented request forms were verified; no real model inference or GPU fit measurement was performed during implementation.

- [Google Gemini latest model](https://ai.google.dev/gemini-api/docs/latest-model?hl=en) and [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
- [Official Qwen3.8-27B model card](https://huggingface.co/Qwen/Qwen3.8-27B) and [vLLM's Qwen serving recipe](https://recipes.vllm.ai/Qwen/Qwen3.8-27B).
- [vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) and [vLLM security/authentication limits](https://docs.vllm.ai/en/latest/usage/security/).

Remaining external qualification: real Gemini quota/generation, pinned Qwen weights and vLLM container loading, authenticated inference, actual GPU memory fit, latency and structured-output behavior. No paid infrastructure has been provisioned.
