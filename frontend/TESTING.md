# Hands-on application test

Open <http://127.0.0.1:5173>. Use a new test mission so your existing configurations remain available. If there is an active run, open it and finish or terminate it before launching another: the server allows one active run.

## 1. Prepare a predictable mission

In **Settings**, set **Future-run simulation speed** to **1**, save, then reload. The value should remain 1. This affects the next launch only.

Go to **Mission Builder** and use these values:

| Field                     | Value             |
| ------------------------- | ----------------- |
| Mission name              | Manual smoke test |
| Duration                  | 600 seconds       |
| Weather severity          | 0                 |
| Environmental disruption  | 0                 |
| Communication reliability | 100               |
| Equipment reliability     | 75                |
| Resource level            | 70                |
| Team count                | 4                 |
| Backup power              | Enabled           |

On the Objectives step:

1. Change the first objective to **incidents_resolved >= 1**, **final**, **required**.
2. Delete the second template objective (the systems deadline objective).
3. Keep equipment availability as **>= 100**, **final**, **optional**.

Review and Save. Reload and inspect the conditions/objectives. Every value should persist.

## 2. Run the success flow

| Action                                  | Expected result                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard → Launch your test mission    | Mission Control opens in **created** state. It has not started automatically.                                                          |
| Start simulation                        | Status becomes **running**; connection shows **Live**; elapsed seconds increase.                                                       |
| Choose Power failure → Trigger incident | Incident appears; power availability falls from 100% to 30%.                                                                           |
| Acknowledge selected incident           | Status becomes acknowledged; power remains impaired.                                                                                   |
| Restore selected incident               | Incident becomes resolved; power returns to 100%; incidents resolved becomes 1. Resources decrease according to the server.            |
| Pause                                   | Status becomes paused; elapsed seconds stay unchanged while you wait a few seconds.                                                    |
| Resume                                  | Elapsed seconds continue.                                                                                                              |
| Finish → confirm Finish run             | A terminal result is produced at the current elapsed time; it does not jump to 600 seconds.                                            |
| View report                             | Overall **Success**; required resolution objective **passed**; optional equipment objective **failed** because equipment is still 75%. |
| Reload report                           | The result, objective evidence, commands, events and telemetry remain available.                                                       |

Use **Restore selected incident** for this test. Equipment diagnostics or restoring all impaired services can improve equipment and change the optional outcome.

## 3. Check objective replacement and validation

Start another unsaved mission draft. On the Objectives step, uncheck Required on each template objective before deleting it; this allows an empty draft temporarily. Add replacements, change their metrics and thresholds, delete a middle row, and add another row. The editor should remain usable and keep the other rows' values. Make at least one objective required before saving.

Deleting the **last required** objective is deliberately disabled while it is still marked required. You can also add another required objective first, then delete the old one.

Try a blank number, duration 59, weather 101, team count 0, a fractional count threshold, or a deadline greater than duration. Try metadata `{"nested":{"value":1}}`. Saving should show useful field validation and retain your draft. Correct the values and save; reload to verify persistence.

The dedicated **Objective Designer** should also allow deleting an optional objective, saving, adding a new objective, saving and reloading without a crash.

## 4. Check failure, comparison and reset

Clone your test mission. Change the required resolution threshold to **2**. Save, launch, start, trigger one power failure, acknowledge/restore it, then finish.

Expected: **Unsuccessful**, because only one incident was resolved. The required objective should show achieved value 1 and target 2.

In **After-Action Reports**, choose the successful and unsuccessful reports in the two comparison selectors. Values should match each saved report, and differing objective configurations should be identified.

Open a terminal run and choose **Reset to new run**. Confirm. The URL/run UUID should change, the new run should be **created**, and the old report should still exist. Terminate the new created run when done to free the active-run slot.

## 5. Check AI without a paid model

Select **Mock / demo** in the AI provider control. Mock is a deterministic template/observation service, not live Gemini/Qwen inference.

- Builder: enter a prompt and Generate mission proposal. Check **DEMO/MOCK** and model provenance. Discard should preserve the original draft. Generate again, Apply, then separately Save. Neither Generate nor Apply should create a saved mission by itself.
- Objective suggestions: select a suggestion before Append/Replace. Save separately. Existing objective identities should persist when appending.
- Mission Control: Explain a selected incident or ask the assistant a question. Text should appear with provenance. Suggested commands must not execute automatically.
- Report: Generate report narrative, then reload. The narrative and provenance should persist; the numerical summary and pass/fail should stay unchanged.

If AI is disabled on the backend, the UI should clearly report unavailable and disable these actions. Core simulation should still work.

## 6. Check keyboard and mobile

Resize the browser to about 390 px wide. Open navigation with the menu button. Pages should fit; wide data tables may scroll within their panel.

Use Tab/Shift+Tab, Enter on map markers, and Escape in a confirmation dialog. Focus should remain visible. A dialog should keep focus inside until closed, then return it to the initiating control. Charts have complete telemetry tables for exact values.

## Repeatable automated checks

Stop development servers on ports 8000/5173 first. The browser configurations start their own backend/Vite servers with disposable SQLite databases.

```text
npm test
npm run test:e2e
npx playwright test --config e2e/mock-ai.config.ts
```

The standard suite covers the application and uses targeted fixtures for some ordering/error/AI responses. The separate mock-AI suite uses the real backend mock service, explicit mock selection, empty live-provider credentials, disabled Qwen and isolated storage. It checks proposal persistence, explanation/chat numerical isolation and persisted report narratives. Neither browser suite verifies TimescaleDB or live model inference.

After testing, restart the local review app with `npm run dev`.
