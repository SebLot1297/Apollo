# Overview simplification

Mission Builder and Objectives use manual configuration. The AI proposal prompt and proposal review panel have been removed; optional mission explanations, strategy guidance and report narratives remain available.

Mission Control keeps the terrain map, active incident inspector and recovery controls. Its active incident selector supports switching between unresolved incidents and highlighting the corresponding system. The incident history, activity log and full event timeline are no longer shown in Mission Control. Mission context occupies the former activity column.

Reports contain incident history and the event timeline. Incident details come from the persisted terminal run using the report's run ID because the existing report response omits incident objects. Reset creates a separate run, preserving the original report's incident history. Loading, empty and retry states are explicit. No backend or stored-schema changes are involved.

Incidents, Event timeline and Accepted command history are now independent collapsible sections, closed by default. Record counts remain visible in their headers. Native details/summary controls support pointer, Enter and Space activation with visible focus. Their content remains mounted, preserving event pagination and query state when toggled; choosing another report starts with the sections closed.

All three UI speed inputs (Mission Control, Dashboard launch and Settings) cap finite positive values above 3600× before submitting. The description explains that 3600× means one simulated hour per real second. Blank, nonfinite, zero and negative values remain invalid. Run speed changes still rely on server confirmation, preserve immutable unknown-outcome retries, and do not change the saved default. The API continues to validate its existing maximum.

These changes supersede the proposal-panel and live-history layout requirements in the earlier atlas plan. Corresponding browser assertions and visual baselines are updated; assistant availability, cooldown behavior, recovery controls and report numerical evidence remain covered.

Verification: production build and frontend lint pass. All 68 Chromium cases were verified: 67 passed in the full run, and objective validation passed in an isolated rerun after concurrent test jobs collided while saving trace files. The real mock-provider assistant/report smoke test passes. Desktop and mobile snapshots were refreshed for all six screens, with layout checks at 1200, 768 and 320 pixels. The local frontend and backend remain available at ports 5173 and 8000.

For the subsequent collapsible-report change, production build, lint and five relevant browser cases pass. Checks cover default closure, independent expansion, Enter/Space keyboard activation, empty incident history, report history after reset, automatic command evidence and blocked-recovery events. Desktop/mobile screenshots and 1200/768/320 layout checks pass without runtime console errors. A duplicate React key found during verification was fixed; the final visual pass also succeeded after retrying a transient screenshot file-write error.
