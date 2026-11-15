"""Explainable rule-based scoring (port of src/lib/scoring.ts + reforesta-profile.ts + regions.ts)."""

# Bump when scoring changes (score.py / profile tables / connector mappers / read-time signals such as history.py).
# Recorded in ingest_runs.scoring_version. Continues the counter of the former TypeScript backend (last value 11).
SCORING_VERSION = 13
