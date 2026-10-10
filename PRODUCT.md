# CommandGrid

CommandGrid is a local, single-user hackathon project for fictional, noncombat infrastructure recovery simulations. Operators configure missions and measurable objectives, launch seeded simulations, respond to system incidents, and review persisted reports.

The backend and simulation engine determine measurements, state transitions, resource costs and objective outcomes. The frontend consumes REST and WebSocket state and sends explicit, idempotent commands. AI assistance is optional; proposals require review and an explicit save, and narratives remain separate from numerical evidence.

Saved mission coordinates are synthetic values from 0–100. Facilities share the health of their corresponding system kind; incidents identify an affected system rather than a geographic facility. The map is illustrative terrain, not a geographic dataset.

Preserve dirty drafts, atomic objective edits, paused simulation timing, manual/automatic recovery rules, command retries, real settings persistence, and historical mission/report snapshots. Backend-only keys and provider availability are not inferred from UI appearance.

The approved visual direction is mockup A, with existing real data substituted for unsupported sample fields. DESIGN.md records the resulting interface. Browser qualification uses isolated SQLite data; it does not establish live provider or TimescaleDB qualification.
