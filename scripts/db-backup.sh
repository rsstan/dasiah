#!/usr/bin/env bash
# One custom-format dump per service schema, taken as app_admin (owner of every object).
# Roles, passwords and extensions are not in the dumps: they come from db/bootstrap.
#   scripts/with-env.sh scripts/db-backup.sh [out_dir]      (default: backups/<UTC timestamp>)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$out"
dump() {
  local name="$1"
  shift
  DB_TOOL=pg_dump "$root/scripts/db-as.sh" app_admin --format=custom --no-unlogged-table-data \
    --file="$out/$name.dump" "$@"
  echo "$out/$name.dump"
}
dump identity -n identity
dump transit -n transit -n transit_staging # staging tables are unlogged: structure only
dump accessibility -n accessibility
dump places -n places
(cd "$out" && sha256sum ./*.dump > SHA256SUMS)
