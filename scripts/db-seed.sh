#!/usr/bin/env bash
# Loads reference data (idempotent upserts) as app_admin.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for f in "$root"/db/seed/reference/*.sql; do
  "$root/scripts/db-as.sh" app_admin -q -v ON_ERROR_STOP=1 -f "$f"
  echo "seeded $(basename "$f")"
done
