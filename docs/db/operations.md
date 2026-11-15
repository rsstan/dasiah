# Database operations: backup and restore

## What a backup contains

| Part | Where it comes from on restore |
| --- | --- |
| Tables, data, views, materialized view, functions, procedures, triggers, indexes, comments, grants of the four service schemas | Per-schema dumps (`pg_dump --format=custom`) |
| Migration history (`<schema>.pgmigrations`) | Inside each dump, so `pnpm db:migrate` continues from the right version |
| Roles, group memberships, schemas, extensions, default privileges | `db/bootstrap/001_roles_schemas.sql` (in Git) |
| Role passwords | Environment (`DB_PASSWORD_*`), applied by `scripts/db-set-passwords.sh` |
| Staging rows (`transit_staging`, unlogged, emptied after each import) | Not backed up (`--no-unlogged-table-data`); structure only |
| Raw GTFS archives | Object storage (`feed_versions.storage_key`), not part of the database backup |

Roles are deliberately not dumped with `pg_dumpall --roles-only`: that output contains the
password hashes, and the backup files would then carry secrets. Roles are recreated from the
bootstrap script and passwords from the secret store.

One dump per service schema matches the service boundaries: one service's data can be restored
without touching the others, and each file holds only data its service owns. The schemas have
no foreign keys or other dependencies on each other, so they can be restored in any order;
`transit` and `transit_staging` belong to one service and share one dump.

## Backup

```bash
pnpm db:backup                       # -> backups/<UTC timestamp>/{identity,transit,accessibility,places}.dump + SHA256SUMS
pnpm db:backup /path/to/dir          # explicit target
```

The dumps are taken as `app_admin`, the owner of every object, so no superuser is needed.
`pg_dump` works from one snapshot per schema; with the low write rate of this system the few
seconds between schema snapshots do not matter (consistency between services is eventual by
design anyway). The client version must be at least the server version (PostgreSQL 16).

Phase 10 runs this nightly on the server and copies the directory to S3. Recovery point =
time of the last backup; continuous archiving (WAL, point-in-time recovery) is out of scope.

## Restore into a new database or server

1. Create the database (Compose does this and runs the bootstrap on an empty volume), or by hand:
   `createdb heatmap`.
2. `pnpm db:bootstrap` — roles, schemas, extensions, default privileges, role passwords from
   the environment. Idempotent.
3. `pnpm db:restore backups/<timestamp>` — checks `SHA256SUMS`, then for each dump, in the order
   `transit`, `identity`, `accessibility`, `places`:
   1. objects and data, skipping `CREATE SCHEMA` (bootstrap made the schemas; `app_admin` may not
      create schemas) and skipping privileges;
   2. `REVOKE ALL` on tables, sequences and routines of the schema from the application roles;
   3. the privileges recorded in the dump.
4. `pnpm db:migrate` — prints "nothing to do" when the backup is from the current release;
   otherwise applies the newer migrations.
5. Check: `pnpm db:dict` and `git diff docs/db/data-dictionary.md` (structure and table privileges
   must match the release), then start the services.

Why steps 3.2 and 3.3 exist: while `pg_restore` creates the objects as `app_admin`, the target's
default privileges grant full DML to the service roles. The dump stores privileges only as the
difference from PostgreSQL's built-in defaults, so restoring it directly would leave those extra
grants in place; for example the service role would regain `UPDATE` and `DELETE` on the
append-only `identity.audit_log`. Revoking first and then applying the recorded grants
reproduces the source privileges exactly. This was found while testing the procedure.

## Restore one schema into a running database

Example: the `places` data is damaged and must be rolled back to the last backup.

```bash
pnpm db:psql superuser -c 'DROP SCHEMA places CASCADE'   # stop the places service first
pnpm db:bootstrap                                        # recreates the empty schema and its grants
pnpm db:restore backups/<timestamp> places
```

Events consumed by `places` after the backup are not replayed: account deletions that happened
since then must be applied again (`SELECT places.erase_user(id)` for the ids in
`identity.v_users_masked WHERE is_deleted`).

## Recreating roles on a new server

Everything about roles is in `db/bootstrap/001_roles_schemas.sql`: group roles (`app_read`,
`app_write`, `*_rw`), login roles (`app_admin`, `svc_*`, `reporting`), memberships, search paths,
schema ownership, database and schema grants, default privileges. Run it once as the superuser
(`pnpm db:bootstrap`), then `pnpm db:passwords` sets the passwords with SCRAM-SHA-256 from the
environment. A new password is rolled out by changing the variable and rerunning `db:passwords`.

## Test record

Tested on 2026-11-15 on PostgreSQL 16 with the migrated database plus `pnpm db:seed:test`:

| Check | Result |
| --- | --- |
| Full restore into a new bootstrapped database | all four dumps restored |
| Row counts of all 37 tables and materialized views | identical |
| Data dictionary of the restored database (structure, constraints, indexes, table privileges) | identical to `docs/db/data-dictionary.md` |
| Routine privileges | identical (compared as sets) |
| `reporting` reads `identity.v_users_masked` | `d***@example.com` |
| `svc_identity` deletes from `identity.audit_log` | `permission denied` (append-only kept) |
| Single-schema restore of `places` after `DROP SCHEMA places CASCADE` | 23 / 2 / 2 rows before and after; dictionary unchanged; `db:migrate` nothing to do |
