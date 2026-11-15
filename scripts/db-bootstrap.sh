#!/usr/bin/env bash
# Runs db/bootstrap/*.sql as the superuser (idempotent) and sets login role passwords.
# In Compose the bootstrap already ran on the first start; running it again is harmless.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGOPTIONS="-c client_min_messages=warning"
for f in "$root"/db/bootstrap/*.sql; do
  "$root/scripts/db-as.sh" superuser -q -v ON_ERROR_STOP=1 -f "$f"
done
DB_TOOL="$root/scripts/db-set-passwords.sh" "$root/scripts/db-as.sh" superuser >/dev/null
echo "bootstrap done for database $PGDATABASE"
