# Part D — AI Providers and Vultr Inference Implementation Plan

The expanded standalone assignment is [Part D complete plan](../2026-10-10-commandgrid-part-d-complete.md). It covers the integrated A/B contracts, detailed implementation tasks, verification and deployment qualification.

> **For agentic workers:** Use the executing-plans skill to work through the checkboxes. This assignment is one workstream in the CommandGrid parallel plan. Request coordinator review when changing a shared interface.

**Goal:** Provide validated optional AI features and deployable secured inference configuration without blocking the core simulator.

**Architecture:** A central AI service selects Gemini, Qwen or explicitly labeled deterministic mock output. B supplies shared domain schemas, A supplies API/audit persistence, and C displays editable proposals and separately labeled narratives.

**Tech Stack:** google-genai, httpx, Pydantic, pytest, Gemini, Qwen, vLLM, Vultr deployment documentation.

## Assignment context

Repository: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.

Read `docs/api-contract.md`, the master plan `docs/superpowers/plans/2026-10-10-commandgrid-parallel.md`, and existing files in your ownership area before editing. Existing code is draft; passing checks, rather than file presence, determine completion. Preserve useful implementation and the established dark operations UI.

This is a fictional, noncombat infrastructure/disaster-support simulator. Only Communications Recovery is enabled initially. Other categories must be visibly unavailable. No real operational locations, targeting, weapon control, or arbitrary executable parameter rules.

In a shared checkout, edit only your assigned files. Do not stage other agents' work, reset files, change branches, or commit/push without coordinator instruction. In separate checkouts, use a dedicated `codex/` branch and commit only your assigned files; the coordinator merges. Root dependency installation and lockfiles belong to Agent A. Send required dependencies to A. Never use paid cloud resources without a separate explicit instruction.

Return: changed files; implemented behavior; exact commands and results; unresolved failures; interface changes; external integrations tested live versus mocked. Do not claim completion from mocks or source inspection alone.

## File ownership

Own `backend/app/services/ai/**`, `backend/tests/test_ai.py`, `infrastructure/vultr/**`, `docs/ai-providers.md`. A owns env template, dependencies, API routes and DB audit schema; send required config changes to A.

Draft config/provider/context/mock files may exist. Inspect them; complete service orchestration and tests. Requested model IDs are defaults to verify against official sources before live deployment, not evidence of successful inference.

## Task D1 — Provider interface and validated output

- [ ] Define provider interface for generate_structured, generate_text and health_check; implement GeminiProvider, QwenProvider and MockAIProvider.
- [ ] Gemini uses official google-genai SDK and backend-only GEMINI_API_KEY/GEMINI_MODEL.
- [ ] Qwen uses OpenAI-compatible HTTP endpoint with backend-only URL/model/API key; support authenticated private/tunneled deployment.
- [ ] Validate every generated mission/objective against B's Pydantic schemas, even when provider declares JSON schema support.
- [ ] Separate text responses from structured proposals; enforce bounded prompts/context/output and safe parsing. Never execute generated expressions or commands.
- [ ] Implement deterministic mock proposals/explanations, explicitly marked mock with fallback reason. No claim that mocked output came from Gemini/Qwen.

## Task D2 — Routing, context, resilience and audit envelope

Expose:

```python
AIService(config=None, *, providers=None)
await service.execute(task, prompt, context={}, provider=None, demo_mode=False)
await service.status()
await service.aclose()
```

- [ ] Support generate_mission, generate_objectives, explain_incident, chat and generate_report tasks.
- [ ] Route mission/objective/report generation primarily to Gemini, assistant/event explanation to Qwen; honor supported settings override.
- [ ] Fall back when unavailable: configured alternate live provider, then deterministic labeled mock. Disabled AI and demo behavior must be explicit.
- [ ] Limit concurrency and requests/minute, use bounded timeout/retries with backoff for transient failures; do not retry invalid requests indefinitely.
- [ ] Cache provider health checks briefly; distinguish configured, available, unavailable and unverified status.
- [ ] Build context from relevant objectives/current systems/recent incidents/commands and compact telemetry. Treat descriptions/user/model text as untrusted data.
- [ ] Return provider/model/mock/fallback_reason/data/usage/latency_ms. Include truthful token usage; unknown costs remain unknown.
- [ ] Coordinate failed-request audit evidence with A as well as success envelopes. Never expose API keys or sensitive endpoint headers.
- [ ] Ensure inference exceptions cannot mutate or stop running simulation; no LLM requests inside ticks.

## Task D3 — Vultr/vLLM deployment preparation

- [ ] Verify official model availability, vLLM/Transformers support and container/model revision compatibility; document dated source links and unverified runtime assumptions.
- [ ] Prepare pinned/configurable model and image config, GPU memory utilization, context 8K–16K, health check, request auth and logs.
- [ ] Document memory sizing including weights, dtype/quantization, KV cache and concurrency. Do not assume a 24GB GPU fits the default model.
- [ ] Prefer private networking or loopback plus SSH tunnel; any public reverse proxy requires TLS, API auth and firewall restrictions.
- [ ] Provide deployment/health/inference smoke commands using env variables without real credentials.
- [ ] Mark provisioning, GPU fit/performance and actual inference as unverified until executed on available authorized infrastructure. Do not create paid resources.
- [ ] Describe how backend config connects to the endpoint and how application remains functional while Qwen is offline.

## Task D4 — Tests without paid services

- [ ] Inject mocked Gemini/Qwen transports/providers for success, timeout, invalid JSON/schema, empty response, unavailable endpoint, auth failure and retry exhaustion.
- [ ] Test routing/override, disabled AI/demo mode, fallback ordering and explicit mock labels.
- [ ] Test rate/concurrency limits, bounded context, health caching and cleanup.
- [ ] Test valid mission/objective proposals against B's schemas; proposal generation must have no save/command side effects.
- [ ] Test secrets absent from returned status/errors/logs.
- [ ] Test narratives cannot overwrite numeric values, objective outcomes or command state.
- [ ] Document mocked checks separately from optional live smoke tests.

Run:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_ai.py -q
```

Expected: passes without live keys, network model calls or GPU.

## Hand off

Send A constructor/config/exception contracts and audit requirements; send C envelope/provenance samples. Return provider test evidence, official compatibility references and explicit live-verification status. Core application must remain usable without credentials.
