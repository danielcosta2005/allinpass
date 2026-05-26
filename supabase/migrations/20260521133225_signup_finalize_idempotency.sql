-- Persist signup-finalize progress so concurrent Edge Function invocations for
-- the same Auth user share one backend finalization instead of creating
-- duplicate projects/subscriptions.
create table if not exists public.signup_finalizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  idempotency_key text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  project_id uuid references public.projects(id) on delete set null,
  response jsonb,
  error_code text,
  error_message text,
  attempts integer not null default 1 check (attempts >= 1),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.signup_finalizations is
  'Idempotency guard for signup-finalize, keyed by auth.users.id.';

create index if not exists signup_finalizations_status_updated_at_idx
  on public.signup_finalizations (status, updated_at);

create index if not exists signup_finalizations_project_id_idx
  on public.signup_finalizations (project_id)
  where project_id is not null;

alter table public.signup_finalizations enable row level security;

revoke all on table public.signup_finalizations from anon;
revoke all on table public.signup_finalizations from authenticated;
grant select, insert, update on table public.signup_finalizations to service_role;
