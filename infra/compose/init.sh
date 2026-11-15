#!/usr/bin/env bash
# One-shot database initialisation for the `full` profile (service db-init, tools image).
# Safe to run on every start: each step is idempotent or skipped when already done.
set -euo pipefail
cd /app
export PGHOST="${PGHOST:-postgres}" PGPORT="${PGPORT:-5432}" PGDATABASE="${POSTGRES_DB:-heatmap}"

for _ in $(seq 1 60); do
  pg_isready -q -U "${POSTGRES_USER:-postgres}" && break
  sleep 1
done

scripts/db-bootstrap.sh            # roles, schemas (idempotent) and role passwords from the environment
node db/tools/migrate.ts           # every service's migrations, as app_admin
scripts/db-seed.sh                 # reference data (upserts)

count() { scripts/db-as.sh superuser -Atqc "$1"; }

# H3 grids of both cities (testville is loaded for waw; a real feed can be imported for either).
for city in waw vno; do
  if [ "$(count "SELECT count(*) FROM transit.hex_cells c JOIN transit.cities USING (city_id) WHERE code = '$city'")" = 0 ]; then
    (cd services/transit-data && node src/cli/grid.ts --city "$city")
  fi
done
if [ "$(count "SELECT count(*) FROM identity.users WHERE email = 'demo.user@example.com'")" = 0 ]; then
  node db/seed/test/seed.ts        # testville active for waw, demo accounts and data
fi

# transit-data runs as user node and writes raw feeds and artifacts here.
if [ -d /data/storage ]; then
  chown -R node:node /data/storage
fi
echo "database ready"
