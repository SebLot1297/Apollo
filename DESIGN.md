# CommandGrid — Spatial atlas

## Authority and composition

The user approved `output/mockups/a-spatial-atlas.png` for implementation. The working interface uses its composition and material language with real server data. `docs/atlas-direction.md` records the approved substitutions.

At 1586 × 992, the horizontal navigation is 54px tall and the mission strip is 78px tall. The map begins at y=132. The map/inspector split is 72.6% / 27.4%, with the inspector at x≈1151.4 and workspace height ≈659.7. The information strip is 200px tall, followed by run tools and evidence. At widths below 1200px, map and inspector stack; below 768px, navigation becomes an accessible drawer and forms become single-column.

## Palette and typography

- Page `#eff5f8`, panel `#f4f8fb`, inset `#e7edf3`, input `#f8fbfd`, divider `#d5e1eb`.
- Ink `#173452`, secondary ink `#486583`, blue `#2c7fad`, operational green `#157e65`, warning text `#936008`, recovery fill `#f4b536`, destructive red `#b44236`.
- Soft status surfaces: blue `#e3eff6`, green `#dff1ea`, amber `#fff0d2`, red `#fbe8e3`.
- Self-hosted Roboto Variable via the locked Fontsource package, with regular, medium, semibold and bold weights. Roboto's OFL license ships with the assets.
- Tabular measurements; compact mm:ss simulation clocks below one hour, hh:mm:ss thereafter. Longer event evidence retains the existing elapsed formatter.
- Identity and mission title 24px; page headings 26px; working headings 17–20px; supporting labels 12–14px. Fine borders, 4–6px radii, restrained shadows. No sidebar, dark variant, gradients or ornamental icon tiles.

## Components and data

Horizontal navigation has a petrol-blue active underline. System meters use blue/steel/amber fills. Status always has readable text alongside color. The recovery inspector uses a split amber execution button with a native action selector, then engine-derived predicted effects. Run tools remain fully accessible below the map, sharing the same command controller and unknown-outcome retry flow as the inspector and header.

Map labels and symbols are semantic buttons over a fixed fictional terrain backplate. Marker positions and schematic links use the same normalized coordinate canvas. Label direction is chosen deterministically; conflicting labels are suppressed while their accessible name and inspector remain available. Mobile markers remain 44px targets, with selection details outside the terrain.

The facility summary reports facility type, actual status and associated system health. It does not claim separate per-facility measurements. Incidents display associated system facilities without asserting a nonexistent facility ID. Recovery costs/effects come from the current recovery-plan API. Regions use actual counts and supplied metrics rather than population, probability or response-time claims.

Dashboard uses overview statistics and mission rows. Builder/Objectives pair editing with a contextual summary; fields remain mounted and validation/save guards remain intact. Reports pair outcome and metric tables before historical evidence. Settings pairs preferences with readiness and provider availability. Empty, loading, error, notification, confirmation and AI states use the same palette.

## Assets and verification

`frontend/public/assets/terrain-atlas.png` is a built-in imagegen edit of the approved mockup. Its prompt and reference provenance are stored in the PNG metadata and adjacent JSON. All text, controls, symbols and meters are implemented separately. `frontend/public/assets/roboto-OFL.txt` is the redistributed font license.

`e2e/atlas.spec.ts` records the reference geometry, covers map selection, corners/overlap, action selection and real engine recovery, and captures all six screens at desktop/mobile sizes. `frontend/screenshots/atlas-native.png` uses an explicitly test-only state fixture. Other screen captures use isolated real backend data. Functional regressions cover transport, reconnection, unknown-outcome retries, forms, preferences, guided/automatic recovery and persisted reports.
