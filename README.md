# CommandGrid

Starter frontend for a fictional, noncombat mission operations platform. Hosted in the Apollo repository.

## Current scope — foundation only

- React, TypeScript, Vite, Tailwind CSS, Lucide React, and React Router configured.
- Responsive dark application shell with sidebar, top bar, and mobile navigation.
- Initial dashboard with one typed fictional demonstration mission and a static scenario map.
- Clearly labeled placeholder routes for Mission Builder, Mission Control, Reports, and Settings.
- Recharts installed for future reporting work.
- Git ignore rules, dependency lockfile, formatting, linting, and browser smoke tests.

Mission editing, objective evaluation, persistence, simulation, and reports are **deferred**. The dashboard's counters and map are static preview data. No authentication, database, API keys, external data APIs, or backend is configured.

## Local development

Use Node.js 22.12+ (tested with Node 24) and npm.

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

```powershell
npm run build
npm run lint
npm run format:check
npx playwright install chromium
npm test
```

`npm run preview` serves the production build. BrowserRouter requires a fallback to `index.html` when eventually deploying to a static host.

## Main files

- `src/App.tsx`: application routes.
- `src/components/layout/AppLayout.tsx`: persistent shell and navigation.
- `src/components/ui/Primitives.tsx`: shared badges, page headings, and panel headings.
- `src/components/dashboard/ScenarioMap.tsx`: static fictional map preview.
- `src/pages/Dashboard.tsx`: initial operations dashboard.
- `src/pages/`: future screen placeholders and setup overview.
- `src/types/mission.ts` and `src/data/demoMission.ts`: typed fictional scenario.
- `src/index.css` and `src/App.css`: visual tokens and responsive styles.
- `e2e/foundation.spec.ts`: navigation, mobile layout, and runtime smoke checks.

## Later phases

1. Mission configuration, parameters, structured objectives, validation, and localStorage.
2. Pure demo simulation state transitions, telemetry, map interaction, and incident response.
3. Computed results, event timelines, Recharts performance views, and report persistence.
4. Once the frontend workflow is approved, introduce a typed transport adapter for FastAPI mission endpoints and versioned WebSocket telemetry. Keep engine calculations outside presentation components.

A broader, unfinished local draft is preserved in `.codex-drafts/commandgrid-deferred-2026-10-09.zip`. It is ignored by Git, inactive, and requires review before reuse.

Setup follows the official [Vite guide](https://vite.dev/guide/) and [Tailwind Vite installation guide](https://tailwindcss.com/docs/installation/using-vite).
