# Retention Policy (Operational)

## Defaults

- Compliance audit events: 90 days (`CHAINSOCIAL_RETENTION_DAYS_AUDIT`).
- Completed DSAR requests: 365 days (`CHAINSOCIAL_RETENTION_DAYS_DSAR_COMPLETED`).

## Execution

- Admin endpoint: `POST /api/admin/compliance/retention`
- Auth: `x-admin-token` header must match `CHAINSOCIAL_ADMIN_TOKEN`.
- Schedule: run daily via cron/job runner.

## Principles

- Minimize retention for personal/operational data.
- Keep open legal requests until closure.
- Never assume on-chain data can be deleted.
