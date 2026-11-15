#!/usr/bin/env bash
# Runs a command with the variables from .env (if present) exported, plus libpq
# defaults derived from them. Variables already in the environment win over .env.
#   scripts/with-env.sh <command> [args...]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$root/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    name="${line%%=*}"
    [ -n "${!name+x}" ] && continue
    export "$line"
  done < "$root/.env"
fi
export PGHOST="${PGHOST:-${PG_HOST:-localhost}}"
export PGPORT="${PGPORT:-${PG_PORT:-5432}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-heatmap}}"
exec "$@"
