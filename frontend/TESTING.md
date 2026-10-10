# Hands-on application test

Open <http://127.0.0.1:5173>. Use a new test mission so your existing configurations remain available. If there is an active run, open it and finish or terminate it before launching another: the server allows one active run.

## 1. Prepare a predictable mission

In **Settings**, set **Default simulation speed** to **1**, save, then reload. The value should remain 1. Saving also updates the current unfinished run and sets the default for future launches and resets across all missions.

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

Review and Save. A confirmed save returns you to the top of the Dashboard and displays **mission saved successfully**. On the saved mission card, choose **Edit**, reload, and inspect the conditions/objectives. Every value should persist.

The success popup appears only after the backend confirms the save, can be closed with **Dismiss notification**, and disappears automatically after eight seconds. Failed saves retain your draft in the editor without showing success or redirecting. If validation fails, **Mission was not saved** appears with field errors; no mission write is sent. When shortening the template to 600 seconds, remove its 21600-second deadline objective as above, or change that deadline to at most 600. While Save is pending, draft controls are disabled.

The dashboard shows **Open active run** only on the mission that owns that run. Other mission cards show a disabled **Launch** and identify the mission to finish or terminate first. Saved configurations become simulations in Mission Control only after launch. A run keeps the mission configuration captured at launch. Saving the default speed updates the current unfinished run; completed reports retain their original evidence.

## 2. Run the success flow

Before clicking **Launch** on your mission card, set **Simulation speed (×)** to the speed you want for that run. Use **1** for this checklist. Fractional speeds are supported; the value must be greater than 0 and at most 3600. **Use saved default** clears your launch override. A choice applies to that run and does not change Settings. Mission Control displays the current speed after launch. In its **Command console**, change **Run speed (×)** and choose **Apply speed**, or click a preset. This changes only the selected run and works before starting, while running, or while paused.

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

### Verify the shared speed preference

1. Pause the run. In **Settings**, change **Default simulation speed** to **4** and **Save preferences**. Reload Settings: the value should remain 4.
2. Return to the run. Its speed should be 4× and its status should remain paused, with unchanged elapsed time.
3. In **Command console**, enter **2** in **Run speed (×)** and click **Apply speed**. The run should show 2×; Settings should still show 4.
4. Terminate the test run. Reset it or launch a different mission using **Use saved default**: the new run should use 4×.
5. A zero, negative, blank or greater-than-3600 run speed should show an error without changing the run. A failed save should retain the draft and display an error.

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

## 7. Check automatic and manual recovery

Create a separate 600-second mission using the conditions above, with **incidents resolved >= 1** and **equipment availability >= 100** both required. Launch it and open **Mission Control → Command console → Recovery commands**.

1. **Automatic recovery** starts off (Manual). Switch it on before starting; wait for the server confirmation, then reload. The switch should stay on.
2. Set **Run speed (×)** to **30** and start. Leave recovery buttons alone. Equipment is repaired after 10 simulated seconds; scheduled incidents are acknowledged and repaired after the simulated recovery delay. The run should finish successfully with the default seed and sufficient resources. The report labels automatic commands and records their times and effects.
3. Repeat at a different speed with the same seed. Automatic decisions use simulated time, so the objective outcome and recovery times should agree.
4. In a separate run, pause with damage outstanding and enable Automatic. No repairs should occur while paused. Switch back to Manual: the pending recovery is cancelled, and manual recovery buttons become available. Resume and wait more than 10 simulated seconds: the cancelled repairs must not execute. Repair the incident manually.
5. With resource level **0**, Automatic must record blocked attempts and leave unmet objectives failed. It must not manufacture resources or successful outcomes.
6. A failed toggle save must show an error and keep the confirmed mode. Completed runs keep their saved evidence. Reset creates a new run retaining its recovery mode; other newly launched missions start in Manual.

The guided demo also supports Automatic: incident auto-pauses are disabled in that mode so it runs unattended. Manual guided demos retain their incident pauses. A deliberate Pause still requires Resume in either mode.

## Repeatable automated checks

Stop development servers on ports 8000/5173 first. The browser configurations start their own backend/Vite servers with disposable SQLite databases.

```text
npm test
npm run test:e2e
npx playwright test --config e2e/mock-ai.config.ts
```

The standard suite covers the application and uses targeted fixtures for some ordering/error/AI responses. The separate mock-AI suite uses the real backend mock service, explicit mock selection, empty live-provider credentials, disabled Qwen and isolated storage. It checks proposal persistence, explanation/chat numerical isolation and persisted report narratives. Neither browser suite verifies TimescaleDB or live model inference.

After testing, restart the local review app with `npm run dev`.
