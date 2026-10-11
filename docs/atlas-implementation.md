# Spatial atlas implementation

CommandGrid now uses the approved mockup A composition and a shared light visual system across Dashboard, Mission Builder, Objectives, Mission Control, Reports and Settings. The original reference remains intact at `output/mockups/a-spatial-atlas.png`. The design tokens and component rules are documented in `DESIGN.md`; product boundaries are in `PRODUCT.md`.

## Delivered behavior

- Horizontal navigation with active underlines, actual connection status, Settings and local workspace context. Mobile navigation supports keyboard trapping, Escape and focus restoration.
- Mission Control's mission strip, terrain map, scrollable incident/recovery inspector and three-column information strip, followed by existing telemetry, objective evidence, history, recovery outlook, run tools and assistant.
- Saved-coordinate facility/team markers, keyboard selection, deterministic label placement and incident-to-system associations. Associated health is explicitly system health. Selections are stored per run; invalid markers and newly resolved active selections clear. Historical resolved incidents can still be selected for AI explanations.
- One shared command controller for the header, inspector and run tools. Server-confirmed outcomes, serialization, destructive confirmations, disconnected blocking, automatic recovery restrictions and immutable unknown-outcome retries remain in place.
- Recovery options retain backend priority and semantic command identity across plan refreshes. Costs/effects are backend values. Created, terminal, automatic, blocked, unavailable-guidance and resolved states have explicit treatments.
- Light forms, charts, tables, dialogs, loading/error/empty states, notifications and AI panels. Builder fields remain mounted; validation focus, dirty drafts, atomic objective saves and report persistence are preserved.

No backend code, public REST/WebSocket contracts, stored schemas, numerical rules, migrations or authentication features changed. Existing route URLs remain the same.

## Assets and accepted differences

`frontend/public/assets/terrain-atlas.png` is a locally served imagegen edit of A's map area. Its exact prompt and source provenance are in the adjacent JSON and embedded PNG metadata. The edit preserves the relief/river/roads direction and framing while removing UI, markers and annotations. Generated terrain remains an illustration; all working map content is HTML/SVG. Roboto Variable is self-hosted through the locked Fontsource dependency; its license ships in `public/assets/roboto-OFL.txt`.

The image-generation tool does not expose a verifiable model selector. The requested GPT Image 2 model cannot be independently confirmed; provenance records this limitation.

The user approved these content differences from A:

| Mockup sample                                       | Working interface                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Severity and exact incident location                | Actual status, detected time, system kind, health and system associations         |
| Estimated duration and success probability          | Available resources and affected-system health                                    |
| Illustrated recovery cost/effects                   | Current recovery-plan cost/effects                                                |
| Separate per-facility measurements                  | Facility type/status and associated system health                                 |
| Population, grid stability, average response claims | Unresolved incidents, resolved incidents, restored systems and supplies delivered |
| Kilometer/elevation/geographic labels               | Fictional terrain and synthetic coordinates/units                                 |

Production facility/team positions remain their saved server coordinates. The generated backplate is a redraw, so individual terrain pixels differ. Real text and functional control dimensions replace generated text artifacts. Crowded labels may be suppressed while accessible marker names and inspector details remain available.

## Visual verification

The representative native screenshot uses an explicitly test-only snapshot/WS fixture in `e2e/atlas.spec.ts`; it never enters production code or persisted simulation data. The per-screen captures exercise a real isolated backend recovery, then scope displayed lists to that run and normalize only mission identity/timestamps for repeatable visual baselines. Numerical values and evidence remain real engine outputs.

At 1586 × 992, `output/atlas-verification/geometry.json` records:

| Region              | Reference    | Measured        |
| ------------------- | ------------ | --------------- |
| Navigation height   | 54px         | 54px            |
| Mission strip       | y=54, h=78   | y=54, h=78      |
| Workspace           | y=132, h=660 | y=132, h=659.67 |
| Inspector left edge | x=1152       | x=1151.42       |
| Bottom strip        | y=792, h=200 | y=791.67, h=200 |

Major boundaries differ by less than one pixel, within the approved 8px allowance. `output/atlas-verification/reference-overlay.png` provides a 50% overlay; `reference-comparison.png` shows A alongside the working screenshot. Content substitutions, generated text and artwork differences are assessed separately rather than folded into a misleading pixel similarity score.

Screenshot baselines cover all six screens at 1440px and 390px, plus the native A scenario. Layout checks additionally cover 1200px, 768px and 320px. Desktop and mobile images were reviewed together, findings fixed in one batch and checked again. The tests verify no page-wide overflow, keyboard marker selection, edges/overlap, long inspector content and resolved-incident behavior. Local table scrolling and chart table alternatives remain available.

Screenshots are in `frontend/screenshots/atlas-*`; repeatable baselines are in `e2e/atlas.spec.ts-snapshots/`.

## Reproduce checks

From the repository root:

```powershell
npm run build
npm run lint
$env:COMMANDGRID_TEST_API_PORT='8020'
$env:COMMANDGRID_TEST_FRONTEND_PORT='5190'
node node_modules/playwright/cli.js test
$env:COMMANDGRID_TEST_API_PORT='8021'
$env:COMMANDGRID_TEST_FRONTEND_PORT='5191'
node node_modules/playwright/cli.js test --config e2e/mock-ai.config.ts
```

The optional test ports avoid interfering with development services. Tests use isolated temporary databases. Standard Chromium coverage includes forms/drafts, report history, reconnection, sequence gates, retries/double submits, speed controls, automatic recovery and unavailable AI. The real mock-AI suite verifies proposal review/Apply/Save, resolved-incident explanations/chat without numerical mutations, and persisted narrative provenance. Live credentialed Gemini/Qwen inference was outside this redesign's verification scope.

Final confirmation on October 10, 2026:

| Check                                                         | Result                  |
| ------------------------------------------------------------- | ----------------------- |
| Production build (`npm run build`)                            | Passed                  |
| Frontend lint (`npm run lint`)                                | Passed                  |
| Complete Chromium suite, including all screenshot comparisons | 70 passed (4.6 minutes) |
| Real mock-AI smoke configuration                              | 3 passed                |
| Whitespace/diff checks                                        | Passed                  |
| Backend source/schema changes                                 | None                    |

The generated reference and original artwork remain unchanged. No runtime or console errors were observed in the screen-coverage checks. Overflow checks passed at all requested widths; ResizeObserver-driven chart measurements are allowed to settle after viewport changes before assertion. No live external mapping service or credentialed AI provider is required for the interface.
