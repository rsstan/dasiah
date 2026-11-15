---
name: verify
description: Checks to run before ticking a plan step or committing. Use at the end of every step.
---

# Verify

Run what applies to the change; all must pass.

| Changed | Run |
| --- | --- |
| Anything | `pnpm lint && pnpm typecheck && pnpm test` |
| Migrations, seeds, bootstrap | fresh database: `pnpm db:bootstrap && pnpm db:migrate && pnpm db:seed && pnpm db:smoke && pnpm db:dict`; `git diff --exit-code docs/db/data-dictionary.md` after committing the regenerated file |
| Contracts | `pnpm contracts:gen && pnpm contracts:lint`; no uncommitted generated changes |
| Service code | `pnpm test:int --filter <service>` |
| Gateway, cross-service flow, compose | `docker compose --profile full up -d --wait && pnpm e2e` |

Then check by reading the diff:

- no secret, token, real email or real address added to the repository or to log statements;
- no query touches a schema the service does not own;
- every new log line inside a request or consumer carries the correlation id (uses the
  request-scoped logger);
- docs touched by the change are updated: the relevant `docs/0x-*.md`, the contracts overview,
  the requirements matrix status;
- the plan step's "Done when" is demonstrably true; paste the command output that shows it into
  the commit or PR description.

If a check cannot pass, do not tick the step: report what failed and why.
