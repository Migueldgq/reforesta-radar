"""Explainable rule-based scoring (port of src/lib/scoring.ts + reforesta-profile.ts + regions.ts)."""

# Bump when base scoring (score.py / profile tables / connector mappers) changes. Recorded in
# ingest_runs.scoring_version. Continues the counter of the former TypeScript backend (last value 11).
SCORING_VERSION = 12
