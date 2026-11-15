---
name: db-change
description: Add or change database objects (tables, columns, indexes, views, triggers, functions, roles, reference data). Use for any change under services/*/migrations, db/bootstrap or db/seed.
---

# Database change

## Steps

1. Decide the owner. The object goes into the schema of exactly one service. If two services
   seem to need it, the data belongs to one and the other gets it through API or event.
2. Create the next numbered file in `services/<service>/migrations/` (`NNNN_<what>.sql`) with
   both sections:

   ```sql
   -- Up Migration
   ...
   -- Down Migration
   ...
   ```

   Never edit a merged migration. Schema-qualify every object name.
3. Write the DDL to the house rules:
   - primary key on every table; foreign keys with an explicit `ON DELETE`;
   - `NOT NULL` unless absence has a meaning; `CHECK` for ranges, formats and closed lists;
   - types: `timestamptz` for moments, `date` for days, `integer` seconds for durations,
     `numeric` for ratios and money, `geography(Point, 4326)` for positions, the `h3_cell` and
     `city_code` domains, `uuid` for ids exposed in the API;
   - no derived columns: derive in a view;
   - no `json/jsonb` except message payloads;
   - named constraints `<table>_<meaning>`; `COMMENT ON` for the table and every column; mark
     personal data with `PII.` at the start of the comment;
   - an index for every foreign key used in joins and for every query in the service's
     repository layer; say in the PR which query each new index serves.
4. Privileges:
   - default privileges already grant DML to the service's `*_rw` role and, in `transit` and
     `accessibility`, `SELECT` to `app_read`;
   - personal data may live only in `identity` and `places`; there, grant `app_read` access
     only through a masked or aggregated view, with an explicit `GRANT SELECT` in the migration;
   - append-only tables: `REVOKE UPDATE, DELETE` from the `*_rw` role;
   - a function that must do what the service role cannot is `SECURITY DEFINER` with
     `SET search_path = <schema>, public, pg_temp`.
5. Reference data changes go to `db/seed/reference/<schema>.sql` as idempotent upserts.
6. Extend `db/tests/smoke.sql`: one positive assertion and one `must_fail` for each new
   constraint, trigger or privilege rule.
7. Run: `pnpm db:migrate`, then down one step and up again, `pnpm db:seed`, `pnpm db:smoke`,
   `pnpm db:dict`.
8. Review the diff of `docs/db/data-dictionary.md`, especially the Privileges section. Update
   `docs/03-database.md` if a rule, index, view or routine was added, and regenerate Kysely types.

## Changing existing data safely

- Adding `NOT NULL`: add the column nullable, backfill, then set `NOT NULL` in the same migration
  if the table is small, in a later one if it is large.
- Renames that break running code are done in two releases: add new, switch code, drop old.
- New roles, schemas or extensions belong in `db/bootstrap` (idempotent) and need a superuser:
  tell the user, since deployed databases must be updated by hand.
