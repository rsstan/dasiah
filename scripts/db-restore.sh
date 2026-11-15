#!/usr/bin/env bash
# Restores the per-schema dumps made by scripts/db-backup.sh into $PGDATABASE as app_admin.
# The target must be a freshly bootstrapped, empty database (roles, empty schemas,
# extensions and default privileges come from db/bootstrap):
#   scripts/with-env.sh scripts/db-bootstrap.sh
#   scripts/with-env.sh scripts/db-restore.sh backups/<timestamp> [transit|identity|accessibility|places ...]
# Without names all four dumps are restored.
#
# Per schema, in three steps:
#   1. objects and data, without CREATE SCHEMA (the bootstrap made the schemas, and app_admin
#      by design may not create schemas) and without privileges;
#   2. revoke what the target's default privileges granted while the objects were created
#      (e.g. UPDATE/DELETE on the append-only identity.audit_log);
#   3. the privileges recorded in the dump, which are exactly the source's.
# Schemas have no cross-schema dependencies, so the order is only a convention.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${1:?usage: db-restore.sh <backup dir> [dump names...]}"
shift
names="${*:-transit identity accessibility places}"
(cd "$dir" && sha256sum --check --quiet SHA256SUMS)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
as_admin() { "$root/scripts/db-as.sh" app_admin "$@"; }
restore() { DB_TOOL=pg_restore "$root/scripts/db-as.sh" app_admin --dbname="$PGDATABASE" --exit-on-error \
  --single-transaction "$@"; }

for name in $names; do
  dump="$dir/$name.dump"
  pg_restore --list "$dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - ' > "$work/all.list"
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ ACL ' "$work/all.list" > "$work/objects.list"
  grep -E '^[0-9]+; [0-9]+ [0-9]+ ACL ' "$work/all.list" > "$work/acl.list" || true

  restore --use-list="$work/objects.list" "$dump"

  schemas=$(pg_restore --list "$dump" | sed -nE 's/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - ([a-z_]+) .*/\1/p')
  for s in $schemas; do
    as_admin -q -v ON_ERROR_STOP=1 -v s="$s" <<'SQL'
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %1$I FROM PUBLIC, app_read, app_write, identity_rw, transit_rw, accessibility_rw, places_rw;
               REVOKE ALL ON ALL SEQUENCES IN SCHEMA %1$I FROM PUBLIC, app_read, app_write, identity_rw, transit_rw, accessibility_rw, places_rw;
               REVOKE ALL ON ALL ROUTINES IN SCHEMA %1$I FROM PUBLIC, app_read, app_write, identity_rw, transit_rw, accessibility_rw, places_rw;', :'s') \gexec
SQL
  done

  restore --use-list="$work/acl.list" "$dump"
  echo "restored $name"
done
