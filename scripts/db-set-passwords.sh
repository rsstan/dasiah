#!/usr/bin/env bash
# Sets passwords for login roles from environment variables (never from Git).
# Needs: PGHOST PGPORT PGDATABASE, a superuser in PGUSER/PGPASSWORD, and
# DB_PASSWORD_APP_ADMIN, DB_PASSWORD_SVC_IDENTITY, DB_PASSWORD_SVC_TRANSIT,
# DB_PASSWORD_SVC_ACCESSIBILITY, DB_PASSWORD_SVC_PLACES, DB_PASSWORD_REPORTING
set -euo pipefail
for role in app_admin svc_identity svc_transit svc_accessibility svc_places reporting; do
  var="DB_PASSWORD_$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  pw="${!var:?missing $var}"
  psql -v ON_ERROR_STOP=1 -v role="$role" -v pw="$pw" <<'SQL'
SET password_encryption = 'scram-sha-256';
ALTER ROLE :"role" PASSWORD :'pw';
SQL
done
