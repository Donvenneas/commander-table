# Phase 2C probes

Read-only scripts used for the Phase 2C audit. They import the game and `tests/scenario.mjs`; they change nothing.

    node audit/phase-2c/probes/probe.mjs .      # P01-P32: runtime probes on real cards
    node audit/phase-2c/probes/probe2.mjs .     # Crucible of Worlds, Omniscience, Yeva (play-from-top misreading)
    node audit/phase-2c/probes/probe3.mjs .     # P33-P41
    node tests/coverage.mjs --json cov.json
    node audit/phase-2c/probes/dump.mjs . cov.json bad.json     # the 197 cards with Oracle text and readings
    node audit/phase-2c/probes/scan.mjs . cov.json              # the same misreadings across all 3,500 cards
    node audit/phase-2c/probes/gen.mjs bad.json <out folder>    # rebuilds the CSV and the per-card section from cards.mjs

A probe printing DEFECT shows the 1.61.0 behaviour described in PHASE_2C_COMPLETE_AUDIT.md; after a fix it should print ok.
