# Supabase Performance Recovery Design

**Date:** 2026-09-02
**Project:** Site administrado Carteira 4.9 (`tjagxmusbnbipeeitsyi`)
**Environment:** Production
**Approved scope:** Clean up the overloaded Supabase project first. Do not change the cadence, business behavior, or architecture of `notifications-runner` in this intervention.

## Objective

Restore predictable database and API latency by stopping the self-amplifying `pg_cron`/`pg_net` workload, reclaiming space held by disposable technical history, and returning the existing jobs to service gradually. Keep the project on Micro while collecting enough post-recovery evidence to decide whether more compute is necessary.

## Incident Evidence

The design is based on a read-only production audit performed on 2026-09-02:

- Database size reported by the dashboard: approximately 1.4 GB.
- `cron.job_run_details`: 1,173 MB.
- `net._http_response`: 199 MB.
- These two technical tables account for approximately 98% of the reported database size.
- `notification_jobs` ready or pending: 0.
- `pass_update_jobs` pending: 0.
- `email_outbox` pending: 0.
- One `notification_jobs` row has been stuck in `processing` since 2026-08-27.
- The stuck row's last error is a timeout while marking the notification as sent. Retrying it could duplicate a notification that was already delivered.
- The `pg_net` response-cleanup statement recorded 240,151 calls and approximately 835,265,409 ms of cumulative execution time since the `pg_stat_statements` reset on 2026-07-10.
- The current active schedules generate 2,208 `net.http_post` runner invocations per day.
- In a recent 100-entry Edge Function sample, `notifications-runner` averaged approximately 79 seconds and reached approximately 150 seconds.
- Recent API logs showed 500/504 responses, including seven 504 responses among nine sampled `/auth/v1/token` calls.
- The cleanup and vacuum jobs added on 2026-09-01 are present, but `pg_stat_all_tables` showed no completed manual vacuum for either technical table at audit time.

## Constraints

- A 15–30 minute maintenance window is approved.
- Customer-facing application access should remain available when the database can serve it.
- Notifications, e-mails, automations, pass updates, and billing background work may be delayed during the maintenance window.
- No customer or business records may be deleted.
- Only disposable execution history, temporary HTTP responses, and obsolete queued runner polls may be removed.
- Do not change `notifications-runner` cadence or logic in this recovery.
- Do not change the other runner cadences in this recovery.
- Do not run `VACUUM FULL` as part of the primary path.
- Do not restart the whole Supabase project unless the targeted recovery fails and a separate decision authorizes it.
- Do not expose or copy bearer tokens, cron secrets, or service-role credentials into logs, documents, or migration files.

## Chosen Approach

Use a controlled pause, selective backlog removal, `TRUNCATE` of disposable technical tables, targeted `pg_net` worker restart, and staged job reactivation.

This approach is preferred because:

- `TRUNCATE` releases the physical pages of the technical tables immediately.
- The retained contents are operational diagnostics, not product data.
- `VACUUM FULL` would rewrite and exclusively lock large tables while the project is already I/O constrained.
- A project restart would not remove the bloated relations or prevent the workload from returning.

## Rejected Alternatives

### Upgrade compute and take no other action

Micro provides necessary headroom and is the correct baseline upgrade from Nano, but it does not remove the 1.37 GB of technical data or break an existing request backlog. Compute alone treats the symptom.

### Preserve all technical history with `VACUUM FULL`

This preserves rows but performs a full table rewrite, requires an exclusive lock, and creates substantial I/O. The historical rows are not valuable enough to justify that recovery risk.

### Change runner architecture during the incident

Event-driven dispatch, single-flight execution, and less frequent fallback polling remain worthwhile follow-up work. Mixing those behavioral changes into the cleanup would increase the incident scope and make rollback harder.

## Recovery Flow

### 1. Preconditions and baseline capture

The operator waits until the Micro upgrade reports `ACTIVE_HEALTHY`. Before any destructive statement, the operator confirms a recent managed backup in the Supabase dashboard.

The operator captures and stores only aggregate evidence:

- sizes of `cron.job_run_details`, `net._http_response`, and `net.http_request_queue`;
- count and oldest creation time of queued HTTP requests, grouped by normalized destination path;
- active cron jobs and schedules;
- active database sessions and oldest query age;
- queue counts by status;
- current CPU, memory, Disk I/O, API error rate, and Edge Function duration screenshots;
- top `pg_stat_statements` rows by total execution time and block activity, with parameter values and credentials excluded.

If the project is not healthy enough to complete these lightweight checks with a 20-second statement timeout, the maintenance continues using the evidence already captured in the incident audit. No repeated diagnostic scans are allowed.

### 2. Pause scheduled producers

Pause every currently active application and maintenance entry in `cron.job` by job name, preserving its command and schedule:

- `notifications-runner-every-minute`
- `billing-expire-trials`
- `automations-runner-every-minute`
- `billing-apply-due-plan-changes`
- `email-dispatcher`
- `pass-updates-runner`
- `billing-close-cycles`
- `delete-cron-job-run-details-after-seven-days`
- `vacuum-cron-job-run-details-daily`
- `vacuum-pg-net-http-responses-daily`

Verify that all ten entries have `active = false`. Wait at least 180 seconds, then confirm that no application cron job is starting and no runner Edge Function has begun within the preceding minute.

### 3. Classify and remove obsolete `pg_net` backlog

Inspect `net.http_request_queue` using aggregate counts by URL path and request age. Never print headers or bodies because they can contain credentials.

Requests are eligible for removal only when all conditions are true:

- the destination is one of the five paused runner endpoints;
- the request was created before the maintenance pause;
- the corresponding application queue has no eligible pending work, or the runner will safely rediscover that work after reactivation;
- the request is a scheduled poll rather than a user-triggered operation.

The five runner endpoints are:

- `/functions/v1/notifications-runner`
- `/functions/v1/automations-runner`
- `/functions/v1/send-email`
- `/functions/v1/pass-updates-runner`
- `/functions/v1/billing-close-cycles`

Do not remove requests for webhooks, signup, pass creation, pass deletion, payment operations, or any other endpoint. If URLs cannot be classified safely, leave the unknown requests untouched.

After removal, verify that no obsolete runner request remains in `net.http_request_queue`.

### 4. Clear disposable technical relations

Clear all rows from:

- `cron.job_run_details`
- `net._http_response`

The operation intentionally discards cron execution history and completed HTTP response diagnostics. It does not touch `net.http_request_queue` beyond the selective removal described above and does not touch any `public`, `auth`, or `storage` business table.

Run `ANALYZE` on the two cleared relations if supported. Restart the `pg_net` background worker with its documented worker restart function. Do not force a checkpoint.

Verify immediately:

- each cleared relation contains zero or only newly generated rows;
- each relation's physical size has fallen to its minimal allocation;
- `net.http_request_queue` contains no obsolete scheduled polls;
- no unexpected long-running session or lock remains.

If either technical relation does not shrink, stop before reactivation and investigate locks or a failed transaction. Do not fall back automatically to `VACUUM FULL`.

### 5. Resolve the stale notification record

Capture the stale row's identifier, timestamps, attempt count, and error text without recording notification content or recipient data.

Move the row from `processing` to terminal `failed`, clear its lock fields, and append an operational reason indicating stale recovery after a `mark_sent` timeout. Do not return it to `pending` and do not send it automatically, because delivery may already have occurred.

Verify that no `notification_jobs` row remains in `processing` with a lock older than five minutes.

### 6. Reset the measurement window

After preserving the pre-recovery aggregate statistics, reset `pg_stat_statements`. This creates a clean measurement window for the Micro instance and recovered database.

Record the reset timestamp. All post-recovery comparisons use this timestamp rather than the earlier July baseline.

### 7. Staged reactivation

Reactivate jobs by name, without changing their commands or schedules, in the following groups:

1. `billing-expire-trials` and `billing-apply-due-plan-changes`
2. `automations-runner-every-minute`
3. `email-dispatcher`
4. `pass-updates-runner`
5. `billing-close-cycles`
6. `notifications-runner-every-minute`
7. the three retention/vacuum maintenance jobs

After each group, observe at least one scheduled execution, or five minutes when the schedule is longer. Check:

- execution completed before the next scheduled occurrence;
- no 500 or 504 response was produced;
- no duplicate runner burst occurred;
- active database queries returned to baseline;
- CPU and Disk I/O did not remain saturated.

If a group violates a check, pause only that group again. Leave previously healthy groups active and investigate the failing group separately.

### 8. Application smoke test

After all groups are active, test the production application with a normal non-administrator account and an administrator account:

- sign in and token refresh;
- load the initial application shell;
- load projects and a project detail;
- load the dashboard KPIs;
- open the notifications area without sending a notification;
- open billing status without changing a plan;
- open Supabase Table Editor and list schemas/tables.

No test may create payments, send notifications, delete passes, or alter customer data.

## Rollback and Failure Handling

Pausing a cron job is reversible by restoring `active = true`; its original command and schedule remain stored. If reactivation causes saturation, pause the affected group again.

Rows removed from `cron.job_run_details` and `net._http_response` are not restored in the normal rollback because they are disposable diagnostics. Their prior aggregate evidence is retained. Recovering those rows would require a database backup restore and is explicitly outside the incident rollback.

If targeted cleanup fails:

1. Keep scheduled producers paused.
2. Keep the customer-facing site available if possible.
3. Capture the exact database error and blocking session information.
4. Do not repeat the same failing operation more than twice.
5. Escalate to a separately approved recovery path, which may include a temporary Small compute size, Supabase Support, or a planned project restart.

## Acceptance Criteria

### Immediate acceptance

- Micro project status is `ACTIVE_HEALTHY`.
- `cron.job_run_details` and `net._http_response` no longer account for material database size.
- No obsolete scheduled runner request remains queued.
- No notification job is stuck with an expired processing lock.
- All ten cron jobs are restored to their pre-maintenance schedules and active state.
- Empty runner executions complete in less than five seconds.
- A runner execution finishes before its next scheduled occurrence.
- The smoke-test flows complete without 500 or 504 responses.
- CPU and Disk I/O are not continuously pinned at 100% for 15 minutes after full reactivation.

### 24–48 hour acceptance

- Average CPU remains below 60%, with no sustained 100% interval longer than five minutes.
- Memory remains below 80%.
- API 500/504 rate remains below 1% outside known client errors.
- The Disk I/O budget does not show renewed rapid depletion.
- `net._http_response` contains only the expected short retention window and remains below 25 MB.
- `cron.job_run_details` grows at the rate implied by the configured schedules and remains below 100 MB.
- No new stale `processing` notification job appears.

If these criteria hold, Micro is accepted as the ongoing compute size. If they fail, profile the post-reset `pg_stat_statements` data before considering Small; do not infer that more compute is the first remedy.

## Follow-up Work Outside This Recovery

The following items are deliberately deferred:

- event-driven runner invocation;
- a low-frequency cron fallback;
- single-flight or lease-based runner execution;
- automatic recovery of stale processing locks with delivery idempotency;
- consolidating runner schedules;
- changing `notifications-runner` behavior or cadence;
- rotating inline cron credentials and moving them to Vault;
- security and performance advisor remediation.

Credential rotation is the highest-priority follow-up after stability because some existing cron commands contain inline secrets. Secret values must never be copied into the follow-up design or migrations.
