#!/usr/bin/env bash
# Drops and recreates the application database, then runs the bootstrap.
# Destroys all data in $PGDATABASE. Local development and CI only.
#   scripts/with-env.sh scripts/db-reset.sh
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db="${PGDATABASE:?missing PGDATABASE}"
"$root/scripts/db-as.sh" superuser -d postgres -v ON_ERROR_STOP=1 -q -v db="$db" <<'SQL'
SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'db') \gexec
SELECT format('CREATE DATABASE %I', :'db') \gexec
SQL
"$root/scripts/db-bootstrap.sh"
