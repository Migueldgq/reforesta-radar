"""Explainable rule-based scoring (port of src/lib/scoring.ts + reforesta-profile.ts + regions.ts)."""

# Bump when base scoring (score.py / profile tables / connector mappers) changes. Same counter as the TS
# SCORING_VERSION in src/lib/cache.ts, so ingest_runs.scoring_version stays comparable across both backends.
SCORING_VERSION = 10
