#!/usr/bin/env bash
# Runs psql (or another libpq tool given in DB_TOOL) as a database role, with the
# password taken from the environment (use through scripts/with-env.sh):
#   scripts/db-as.sh superuser|app_admin|svc_identity|... [psql args...]
set -euo pipefail
role="$1"
shift
tool="${DB_TOOL:-psql}"
if [ "$role" = superuser ]; then
  export PGUSER="${POSTGRES_USER:-postgres}"
  export PGPASSWORD="${POSTGRES_PASSWORD:?missing POSTGRES_PASSWORD}"
else
  var="DB_PASSWORD_$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  export PGUSER="$role"
  export PGPASSWORD="${!var:?missing $var}"
fi
if [ "$tool" = psql ]; then
  exec psql -X "$@"
fi
exec "$tool" "$@"
