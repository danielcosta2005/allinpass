


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "wallet";


ALTER SCHEMA "wallet" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_and_increment_notifications"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
declare
  v_limit integer;
  v_recent integer;
  v_exp timestamptz;
begin
  -- 1) Garante que existe linha para o projeto (auto-provision)
  --    notifications_limit = NULL => ilimitado
  insert into public.projects_notifications (
    project_id,
    notifications_limit,
    total_notifications_sent,
    notifications_exp,
    recent_notifications_sent,
    created_at
  )
  values (
    p_project_id,
    null, -- ilimitado por padrão
    0,
    date_trunc('month', now()) + interval '1 month',
    0,
    now()
  )
  on conflict (project_id) do nothing;

  -- 2) Trava a linha e carrega dados
  select notifications_limit, recent_notifications_sent, notifications_exp
    into v_limit, v_recent, v_exp
  from public.projects_notifications
  where project_id = p_project_id
  for update;

  -- 3) Se a janela expirou, reseta contador recente e renova expiração
  if v_exp <= now() then
    update public.projects_notifications
    set
      recent_notifications_sent = 0,
      notifications_exp = date_trunc('month', now()) + interval '1 month'
    where project_id = p_project_id;

    v_recent := 0;

    select notifications_limit
      into v_limit
    from public.projects_notifications
    where project_id = p_project_id;
  end if;

  -- 4) Checa limite SOMENTE se não for ilimitado
  if v_limit is not null and v_recent >= v_limit then
    return false;
  end if;

  -- 5) Incrementa contadores
  update public.projects_notifications
  set
    recent_notifications_sent = recent_notifications_sent + 1,
    total_notifications_sent = total_notifications_sent + 1
  where project_id = p_project_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."check_and_increment_notifications"("p_project_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."notification_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "notification_id" "uuid",
    "event_id" "uuid",
    "customer_id" "uuid",
    "user_pass_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "notification_type" "text" NOT NULL,
    "title" "text",
    "body" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "scheduled_for" timestamp with time zone,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 8 NOT NULL,
    "last_error" "text",
    "last_error_at" timestamp with time zone,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_jobs_platform_check" CHECK (("platform" = ANY (ARRAY['apple'::"text", 'google'::"text"]))),
    CONSTRAINT "notification_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text", 'canceled'::"text", 'rate_limited'::"text"])))
);


ALTER TABLE "public"."notification_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_notification_jobs"("p_limit" integer, "p_worker" "text", "p_lock_timeout_minutes" integer DEFAULT 5) RETURNS SETOF "public"."notification_jobs"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_now timestamptz := now();
  v_lock_expired_before timestamptz := now() - (p_lock_timeout_minutes || ' minutes')::interval;
begin
  return query
  with cte as (
    select id
    from public.notification_jobs
    where status in ('pending', 'rate_limited')
      and available_at <= v_now
      and (scheduled_for is null or scheduled_for <= v_now)
      and (locked_at is null or locked_at < v_lock_expired_before)
    order by priority asc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.notification_jobs j
  set
    status = 'processing',
    locked_at = v_now,
    locked_by = p_worker,
    updated_at = v_now
  from cte
  where j.id = cte.id
  returning j.*;
end;
$$;


ALTER FUNCTION "public"."claim_notification_jobs"("p_limit" integer, "p_worker" "text", "p_lock_timeout_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_automation_notifications"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_jobs_created integer := 0;
BEGIN

  WITH eligible AS (

    SELECT
      a.id                AS automation_id,
      a.project_id,
      a.type,
      a.quantity,
      a.message,

      up.id               AS user_pass_id,
      up.install_platform,
      up.pass_token,
      up.expires_at,
      up.last_visit,
      up.metadata

    FROM public.automations a

    JOIN public.user_passes up
      ON up.project_id = a.project_id

    LEFT JOIN public.automation_dispatches ad
      ON ad.automation_id = a.id
     AND ad.user_pass_id = up.id
     AND ad.reference_date = current_date

    WHERE a.status = 'on'
      AND up.removed_at IS NULL
      AND up.pass_token IS NOT NULL
      AND ad.id IS NULL

      AND (

        (
          a.type = 'points_wallet'
          AND coalesce(nullif(up.metadata ->> 'points','')::integer,0) = a.quantity
        )

        OR

        (
          a.type = 'days_without_visit'
          AND up.last_visit IS NOT NULL
          AND (current_date - up.last_visit::date) = a.quantity
        )

        OR

        (
          a.type = 'expiring_soon'
          AND up.expires_at IS NOT NULL
          AND (up.expires_at::date - current_date) = a.quantity
        )

      )
  ),

  inserted_dispatches AS (

    INSERT INTO public.automation_dispatches (
      automation_id,
      user_pass_id,
      reference_date
    )

    SELECT
      e.automation_id,
      e.user_pass_id,
      current_date

    FROM eligible e

    ON CONFLICT (automation_id, user_pass_id, reference_date)
    DO NOTHING

    RETURNING automation_id, user_pass_id

  ),

  inserted_jobs AS (

    INSERT INTO public.notification_jobs (

      project_id,
      notification_id,
      event_id,
      customer_id,
      user_pass_id,

      platform,
      notification_type,
      title,
      body,
      data,

      idempotency_key,
      status,
      priority,
      scheduled_for,
      available_at,
      attempts,
      max_attempts

    )

    SELECT

      e.project_id,
      NULL,
      NULL,
      NULL,
      e.user_pass_id,

      e.install_platform AS platform,

      'automation' AS notification_type,

      CASE
        WHEN e.type = 'points_wallet' THEN 'Meta de pontos atingida'
        WHEN e.type = 'days_without_visit' THEN 'Sentimos sua falta'
        WHEN e.type = 'expiring_soon' THEN 'Seu passe esta prestes a expirar'
        ELSE 'Notificacao automatica'
      END AS title,

      e.message AS body,

      jsonb_build_object(
        'source','automation',
        'automation_id', e.automation_id,
        'automation_type', e.type,
        'quantity', e.quantity,
        'pass_token', e.pass_token
      ) AS data,

      'automation:' ||
      e.automation_id::text || ':' ||
      e.user_pass_id::text || ':' ||
      current_date::text

      AS idempotency_key,

      'pending' AS status,
      100 AS priority,

      now() AS scheduled_for,
      now() AS available_at,

      0 AS attempts,
      8 AS max_attempts

    FROM eligible e

    JOIN inserted_dispatches d
      ON d.automation_id = e.automation_id
     AND d.user_pass_id = e.user_pass_id

    ON CONFLICT (project_id, idempotency_key)
    DO NOTHING

    RETURNING id

  )

  SELECT count(*)
  INTO v_jobs_created
  FROM inserted_jobs;


  RETURN jsonb_build_object(
    'success', true,
    'jobs_created', v_jobs_created,
    'executed_at', now()
  );

END;
$$;


ALTER FUNCTION "public"."enqueue_automation_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_find_user_id"("p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid;
  is_admin boolean;
begin
  select public.is_superadmin() into is_admin;
  if not is_admin then
    raise exception 'not_allowed';
  end if;

  select u.id into uid
  from auth.users u
  where u.email = p_email
  limit 1;

  return uid;
end $$;


ALTER FUNCTION "public"."fn_find_user_id"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_global_kpis"() RETURNS TABLE("projects" integer, "customers" integer, "visits" integer, "rewards_unlocked" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select
    (select count(*) from public.projects)::integer as projects,
    (select count(distinct c.id) from public.customers c)::integer as customers,
    (select count(*) from public.events e where e.type='visit')::integer as visits,
    (select count(*) from public.events e where e.type='reward_unlocked')::integer as rewards_unlocked;
$$;


ALTER FUNCTION "public"."fn_get_global_kpis"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_global_kpis_timeseries"("p_months" integer) RETURNS TABLE("month" "date", "visits" integer, "rewards" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  with months as (
    select date_trunc('month', (now() - (i || ' months')::interval))::date as m
    from generate_series(0, p_months-1) i
  )
  select m.m as month,
    coalesce( (select count(*) from public.events e
              where e.type='visit'
                and date_trunc('month', e.at)=m.m), 0)::integer as visits,
    coalesce( (select count(*) from public.events e
              where e.type='reward_unlocked'
                and date_trunc('month', e.at)=m.m), 0)::integer as rewards
  from months m
  order by m.m;
$$;


ALTER FUNCTION "public"."fn_get_global_kpis_timeseries"("p_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_project_analytics"("p_project_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_member BOOLEAN;
  v_is_superadmin BOOLEAN;
  result JSONB;
BEGIN
  SELECT is_member_of(p_project_id) INTO v_is_member;
  SELECT is_superadmin() INTO v_is_superadmin;

  IF NOT v_is_member AND NOT v_is_superadmin THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  WITH visits_in_period AS (
    SELECT
      id,
      at AS visited_at
    FROM public.events
    WHERE
      project_id = p_project_id AND
      type = 'visit' AND
      at >= p_start_date AND
      at <= p_end_date
  ),
  kpis AS (
    SELECT
      COUNT(DISTINCT customer_id) AS active_customers,
      COUNT(*) AS visits_this_cycle,
      (SELECT COUNT(*) FROM public.events e WHERE e.project_id = p_project_id AND e.type = 'reward_unlocked' AND e.at >= p_start_date AND e.at <= p_end_date) AS rewards_unlocked,
      (SELECT COUNT(*) FROM public.wallet_links wl WHERE wl.project_id = p_project_id AND wl.created_at >= p_start_date AND wl.created_at <= p_end_date) AS wallet_linked
    FROM public.events
    WHERE project_id = p_project_id AND type = 'visit' AND at >= p_start_date AND at <= p_end_date
  ),
  visits_by_dow AS (
    SELECT
      -- TO_CHAR is locale-dependent, EXTRACT is universal. 1=Sun, 2=Mon...
      EXTRACT(DOW FROM visited_at) AS day_of_week_num,
      COUNT(*) AS visit_count
    FROM visits_in_period
    GROUP BY day_of_week_num
  ),
  visits_by_dom AS (
    SELECT
      EXTRACT(DAY FROM visited_at) AS day_of_month,
      COUNT(*) AS visit_count
    FROM visits_in_period
    GROUP BY day_of_month
  ),
  visits_by_hod AS (
    SELECT
      EXTRACT(HOUR FROM visited_at) AS hour_of_day,
      COUNT(*) AS visit_count
    FROM visits_in_period
    GROUP BY hour_of_day
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT to_jsonb(kpis) FROM kpis),
    'by_day_of_week', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM visits_by_dow v), '[]'::jsonb),
    'by_day_of_month', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM visits_by_dom v), '[]'::jsonb),
    'by_hour_of_day', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM visits_by_hod v), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."fn_get_project_analytics"("p_project_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_project_kpis"("p_project_id" "uuid") RETURNS TABLE("active_customers" bigint, "visits_this_cycle" bigint, "rewards_unlocked" bigint, "wallet_linked" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    (SELECT count(DISTINCT c.id) FROM public.customers c WHERE c.project_id = p_project_id) as active_customers,
    (SELECT count(v.*) FROM public.visits v WHERE v.project_id = p_project_id AND v.created_at >= (CURRENT_DATE - INTERVAL '30 days')) as visits_this_cycle,
    (SELECT count(e.*) FROM public.events e WHERE e.project_id = p_project_id AND e.type = 'reward_unlocked') as rewards_unlocked,
    (SELECT count(wl.*) FROM public.wallet_links wl WHERE wl.project_id = p_project_id) as wallet_linked;
$$;


ALTER FUNCTION "public"."fn_get_project_kpis"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_project_kpis_timeseries"("p_project_id" "uuid", "p_months" integer) RETURNS TABLE("month" "date", "visits" integer, "rewards_unlocked" integer, "wallet_linked" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with months as (
    select date_trunc('month', (now() - (i || ' months')::interval))::date as m
    from generate_series(0, p_months-1) i
  )
  select m.m as month,
    coalesce( (select count(*) from public.events e
               where e.project_id=p_project_id and e.type='visit'
                 and date_trunc('month', e.at)=m.m), 0)::integer as visits,
    coalesce( (select count(*) from public.events e
               where e.project_id=p_project_id and e.type='reward_unlocked'
                 and date_trunc('month', e.at)=m.m), 0)::integer as rewards_unlocked,
    coalesce( (select count(*) from public.events e
               where e.project_id=p_project_id and e.type='wallet_linked'
                 and date_trunc('month', e.at)=m.m), 0)::integer as wallet_linked
  from months m
  order by m.m;
$$;


ALTER FUNCTION "public"."fn_get_project_kpis_timeseries"("p_project_id" "uuid", "p_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_project_kpis_v2"("p_project_id" "uuid") RETURNS TABLE("active_customers" integer, "visits_this_cycle" integer, "rewards_unlocked" integer)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    (SELECT COUNT(*) FROM public.customers c WHERE c.project_id = p_project_id) AS active_customers,
    (SELECT COUNT(*) FROM public.visits v WHERE v.project_id = p_project_id AND v.created_at >= (CURRENT_DATE - INTERVAL '30 days')) AS visits_this_cycle,
    (SELECT COUNT(*) FROM public.loyalty_states l WHERE l.project_id = p_project_id AND l.points >= 10) AS rewards_unlocked;
$$;


ALTER FUNCTION "public"."fn_get_project_kpis_v2"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_stats"("p_project" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_admin boolean;
  v_total int;
  v_perto int;
  v_completos int;
begin
  select public.is_superadmin() into v_is_admin;
  if not v_is_admin and not public.is_member_of(p_project) then
    raise exception 'not_allowed';
  end if;

  select count(*) into v_total
  from public.customers c
  where c.project_id = p_project;

  select count(*) into v_completos
  from public.loyalty_states s
  where s.project_id = p_project and s.points >= 10;

  select count(*) into v_perto
  from public.loyalty_states s
  where s.project_id = p_project and s.points between 7 and 9;

  return jsonb_build_object(
    'totalClientes', coalesce(v_total,0),
    'pertoDeGanhar', coalesce(v_perto,0),
    'completos', coalesce(v_completos,0)
  );
end $$;


ALTER FUNCTION "public"."fn_get_stats"("p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_stats_all"() RETURNS TABLE("project_id" "uuid", "name" "text", "totalclientes" bigint, "pertodeganhar" bigint, "completos" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;
begin
  for r in
    select p.id, coalesce(p.name, '(sem nome)') as name
    from public.projects p
    where public.is_superadmin()
       or exists (select 1 from public.project_members m
                  where m.project_id = p.id and m.user_id = auth.uid())
  loop
    return query
      select r.id,
             r.name,
             s.totalclientes,
             s.pertodeganhar,
             s.completos
      from public.fn_get_stats(r.id) as s;
  end loop;
end $$;


ALTER FUNCTION "public"."fn_get_stats_all"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_issuer_from_class"("p_class_id" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT split_part(btrim(p_class_id), '.', 1)
$$;


ALTER FUNCTION "public"."fn_issuer_from_class"("p_class_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text" DEFAULT 'staff'::"text") RETURNS TABLE("ok" boolean, "user_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  uid uuid;
  attempts integer := 0;
begin
  -- Tenta encontrar o usuário, com algumas tentativas para lidar com a replicação
  while uid is null and attempts < 5 loop
    select id into uid from auth.users where email = p_email;
    if uid is null then
      attempts := attempts + 1;
      perform pg_sleep(0.1); -- Espera 100ms antes de tentar novamente
    end if;
  end loop;

  if uid is null then
    raise exception 'Falha ao encontrar o usuário % no sistema de autenticação após várias tentativas.', p_email;
  end if;

  -- Garante que o perfil exista e tenha o papel 'establishment'
  insert into public.profiles (id, role)
  values (uid, 'establishment')
  on conflict (id) do update 
  set role = 'establishment'
  where profiles.role is distinct from 'establishment';

  -- Garante o vínculo do membro ao projeto com o papel desejado
  insert into public.project_members (project_id, user_id, role)
  values (p_project, uid, coalesce(nullif(lower(p_role),''),'staff'))
  on conflict (project_id, user_id) do update 
  set role = excluded.role;

  return query select true, uid;
end;
$$;


ALTER FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_list_customers_with_visits"("p_project_id" "uuid") RETURNS TABLE("id" "uuid", "google_sub" "text", "name" "text", "email" "text", "created_at" timestamp with time zone, "visits" integer, "pass_status" "text")
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    c.id,
    c.google_sub,
    c.name,
    c.email,
    c.created_at,
    COALESCE(c.visits, 0)::integer as visits,
    c.pass_status
  FROM public.customers c
  WHERE c.project_id = p_project_id
  ORDER BY c.created_at DESC;
$$;


ALTER FUNCTION "public"."fn_list_customers_with_visits"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_list_members"("p_project" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "role" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    pm.user_id,
    (select u.email from auth.users u where u.id = pm.user_id)::text as email,
    pm.role::text,
    pm.created_at
  from public.project_members pm
  where pm.project_id = p_project
  order by pm.created_at desc;
$$;


ALTER FUNCTION "public"."fn_list_members"("p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_list_visits"("p_project_id" "uuid") RETURNS TABLE("id" "uuid", "customer_google_sub" "text", "customer_email" "text", "visited_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    v.id,
    v.customer_google_sub,
    v.customer_email,
    v.created_at AS visited_at
  FROM public.visits v
  WHERE v.project_id = p_project_id
  ORDER BY v.created_at DESC;
$$;


ALTER FUNCTION "public"."fn_list_visits"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_scanner_visit"("p_project" "uuid", "p_google_sub" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  u uuid := auth.uid();
  v_is_admin boolean;
  v_is_member boolean;
  v_customer_id uuid;
  v_points int;
  v_cycle_start date;
  v_cycle_end date;
  v_completed boolean := false;
  v_now timestamptz := now();
begin
  -- permissão: membro do projeto ou superadmin
  select public.is_superadmin() into v_is_admin;
  select public.is_member_of(p_project) into v_is_member;

  if not v_is_admin and not v_is_member then
    raise exception 'Acesso negado. Você não tem permissão para registrar visitas neste projeto.';
  end if;

  -- upsert do cliente
  insert into public.customers (project_id, google_sub, name, email)
  values (p_project, p_google_sub, null, null)
  on conflict (project_id, google_sub) do nothing;

  select id into v_customer_id
  from public.customers
  where project_id = p_project and google_sub = p_google_sub;

  -- upsert do estado
  insert into public.loyalty_states (project_id, customer_id, points, cycle_start, cycle_end)
  values (p_project, v_customer_id, 0, v_now::date, (v_now::date + interval '30 days')::date)
  on conflict (project_id, customer_id) do nothing;

  -- ciclo/points
  select points, cycle_start, cycle_end
    into v_points, v_cycle_start, v_cycle_end
  from public.loyalty_states
  where project_id = p_project and customer_id = v_customer_id
  for update;

  if v_now::date > v_cycle_end then
    v_points := 0;
    v_cycle_start := v_now::date;
    v_cycle_end := (v_now::date + interval '30 days')::date;
  end if;

  v_points := coalesce(v_points,0) + 1;
  if v_points >= 10 then
    v_completed := true;
  end if;

  update public.loyalty_states
  set points = v_points,
      cycle_start = v_cycle_start,
      cycle_end = v_cycle_end,
      updated_at = v_now
  where project_id = p_project and customer_id = v_customer_id;

  insert into public.events(project_id, customer_id, type, value, at, meta)
  values (p_project, v_customer_id, 'visit', '1', v_now, jsonb_build_object('scanner_id', u));

  if v_completed then
    insert into public.events(project_id, customer_id, type, value, at, meta)
    values (p_project, v_customer_id, 'reward_unlocked', null, v_now, jsonb_build_object('points', v_points));
  end if;

  return jsonb_build_object(
    'points', v_points,
    'cycle_start', v_cycle_start,
    'cycle_end', v_cycle_end,
    'completed', v_completed
  );
end $$;


ALTER FUNCTION "public"."fn_scanner_visit"("p_project" "uuid", "p_google_sub" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_upsert_customer"("p_project" "uuid", "p_google_sub" "text", "p_email" "text" DEFAULT NULL::"text", "p_name" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.customers WHERE project_id = p_project AND google_sub = p_google_sub;
  IF v_id IS NULL THEN
    INSERT INTO public.customers(project_id, google_sub, email, name) VALUES (p_project, p_google_sub, p_email, p_name) RETURNING id INTO v_id;
  ELSE
    UPDATE public.customers SET email = COALESCE(p_email, email), name = COALESCE(p_name, name) WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."fn_upsert_customer"("p_project" "uuid", "p_google_sub" "text", "p_email" "text", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_upsert_customer"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text", "p_avatar_url" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_customer_id uuid;
BEGIN
    INSERT INTO public.customers (project_id, google_sub, name, email, avatar_url)
    VALUES (p_project_id, p_google_sub, p_name, p_email, p_avatar_url)
    ON CONFLICT (project_id, google_sub)
    DO UPDATE SET
        name = COALESCE(EXCLUDED.name, customers.name),
        email = COALESCE(EXCLUDED.email, customers.email),
        avatar_url = COALESCE(EXCLUDED.avatar_url, customers.avatar_url),
        updated_at = NOW()
    RETURNING id INTO v_customer_id;
    
    INSERT INTO public.loyalty_states (customer_id)
    VALUES (v_customer_id)
    ON CONFLICT (customer_id) DO NOTHING;
    
    RETURN v_customer_id;
END;
$$;


ALTER FUNCTION "public"."fn_upsert_customer"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text", "p_avatar_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_upsert_customer_v2"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_customer_id uuid;
BEGIN
    IF p_project_id IS NULL OR p_google_sub IS NULL THEN
        RAISE EXCEPTION 'project_id e google_sub são obrigatórios';
    END IF;

    INSERT INTO public.customers (project_id, google_sub, name, email)
    VALUES (p_project_id, p_google_sub, p_name, p_email)
    ON CONFLICT (project_id, google_sub)
    DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        updated_at = NOW()
    RETURNING id INTO v_customer_id;

    RETURN v_customer_id;
END;
$$;


ALTER FUNCTION "public"."fn_upsert_customer_v2"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pass_owner"("p_token" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT user_id FROM public.user_passes WHERE pass_token = p_token LIMIT 1;
$$;


ALTER FUNCTION "public"."get_pass_owner"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_wallet_link_and_customer_points"("p_project_id" "uuid", "p_google_sub" "text") RETURNS TABLE("wallet_link_id" "uuid", "google_object_id" "text", "customer_id" "uuid", "points" integer, "cycle_start" "date", "cycle_end" "date", "last_visit_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_customer_id uuid;
  v_wallet_link_id uuid;
  v_google_object_id text;
  v_ls_id uuid;
  v_now timestamptz := now();
  v_first_visit timestamptz;
  v_visits_count int;
BEGIN
  SELECT c.id, wl.id, wl.google_object_id
    INTO v_customer_id, v_wallet_link_id, v_google_object_id
  FROM public.customers c
  LEFT JOIN public.wallet_links wl ON wl.customer_id = c.id AND wl.project_id = p_project_id
  WHERE c.project_id = p_project_id AND c.google_sub = p_google_sub
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- Try to find existing loyalty_state
  SELECT id, points, cycle_start, cycle_end
    INTO v_ls_id, points, cycle_start, cycle_end
  FROM public.loyalty_states
  WHERE project_id = p_project_id AND customer_id = v_customer_id
  LIMIT 1;

  -- Determine last visit
  SELECT max(created_at) INTO last_visit_at FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id;

  IF v_ls_id IS NULL THEN
    -- No state: compute based on visits in last 30 days
    SELECT min(created_at) INTO v_first_visit FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id AND created_at >= v_now - interval '30 days';
    IF v_first_visit IS NULL THEN
      -- No recent visits, create new cycle starting today with 0 points
      INSERT INTO public.loyalty_states(project_id, customer_id, points, cycle_start, cycle_end, updated_at)
      VALUES (p_project_id, v_customer_id, 0, CURRENT_DATE, (CURRENT_DATE + 30), now())
      RETURNING id, points, cycle_start, cycle_end INTO v_ls_id, points, cycle_start, cycle_end;
    ELSE
      -- Count visits since first visit in window
      SELECT count(*) INTO v_visits_count FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id AND created_at >= v_first_visit;
      points := LEAST(v_visits_count, 10);
      INSERT INTO public.loyalty_states(project_id, customer_id, points, cycle_start, cycle_end, updated_at)
      VALUES (p_project_id, v_customer_id, points, v_first_visit::date, (v_first_visit::date + 30), now())
      RETURNING id, points, cycle_start, cycle_end INTO v_ls_id, points, cycle_start, cycle_end;
    END IF;
  ELSE
    -- Existing state: check expiry or 10+ visits/reward
    IF cycle_end IS NOT NULL AND v_now::date >= cycle_end THEN
      -- cycle expired: start new cycle from first recent visit or today
      SELECT min(created_at) INTO v_first_visit FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id AND created_at >= v_now - interval '30 days';
      IF v_first_visit IS NULL THEN
        UPDATE public.loyalty_states SET points = 0, cycle_start = CURRENT_DATE, cycle_end = (CURRENT_DATE + 30), updated_at = now() WHERE id = v_ls_id RETURNING points, cycle_start, cycle_end INTO points, cycle_start, cycle_end;
      ELSE
        SELECT count(*) INTO v_visits_count FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id AND created_at >= v_first_visit;
        points := LEAST(v_visits_count, 10);
        UPDATE public.loyalty_states SET points = points, cycle_start = v_first_visit::date, cycle_end = (v_first_visit::date + 30), updated_at = now() WHERE id = v_ls_id RETURNING points, cycle_start, cycle_end INTO points, cycle_start, cycle_end;
      END IF;
    ELSE
      -- cycle still valid: count visits since cycle_start
      SELECT count(*) INTO v_visits_count FROM public.visits WHERE project_id = p_project_id AND customer_id = v_customer_id AND created_at >= cycle_start;
      IF v_visits_count >= 10 THEN
        -- Redeem: reset points and set new cycle_start to now
        UPDATE public.loyalty_states SET points = 0, cycle_start = CURRENT_DATE, cycle_end = (CURRENT_DATE + 30), updated_at = now() WHERE id = v_ls_id RETURNING points, cycle_start, cycle_end INTO points, cycle_start, cycle_end;
        -- record reward_unlocked event
        INSERT INTO public.events(project_id, customer_id, type, value, meta, at)
        VALUES (p_project_id, v_customer_id, 'reward_unlocked', NULL, jsonb_build_object('reason','auto_redeem','visits', v_visits_count), now());
      ELSE
        points := v_visits_count;
        UPDATE public.loyalty_states SET points = points, updated_at = now() WHERE id = v_ls_id RETURNING points, cycle_start, cycle_end INTO points, cycle_start, cycle_end;
      END IF;
    END IF;
  END IF;

  wallet_link_id := v_wallet_link_id;
  google_object_id := v_google_object_id;
  customer_id := v_customer_id;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."get_wallet_link_and_customer_points"("p_project_id" "uuid", "p_google_sub" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'restaurant')
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'customer')
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of"("p_project" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project AND pm.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_member_of"("p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_org"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_member_of_org"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_project"("p_project" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_member_of_project"("p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_project"("p_user" "uuid", "p_project" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = p_user AND pm.project_id = p_project);
$$;


ALTER FUNCTION "public"."is_member_of_project"("p_user" "uuid", "p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_pass_belongs_to_current_user_by_token"("token_text" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_passes up
    WHERE up.pass_token = token_text
      AND up.user_id = (SELECT auth.uid())
  );
$$;


ALTER FUNCTION "public"."is_pass_belongs_to_current_user_by_token"("token_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_staff"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner','staff')
  );
$$;


ALTER FUNCTION "public"."is_project_staff"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_superadmin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin');
$$;


ALTER FUNCTION "public"."is_superadmin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_wallet_config_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
    BEGIN
        INSERT INTO public.wallet_configs_history (wallet_config_id, project_id, pass_template, reason)
        VALUES (NEW.id, NEW.project_id, NEW.pass_template, 'config_update');
        RETURN NEW;
    END;
    $$;


ALTER FUNCTION "public"."log_wallet_config_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_multiple_sessions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  BEGIN
    DELETE FROM auth.sessions
    WHERE user_id = NEW.user_id
      AND id <> NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_multiple_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."read_secret"("secret_name" "text") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT value::text
  FROM secrets
  WHERE name = secret_name
  LIMIT 1;
$$;


ALTER FUNCTION "public"."read_secret"("secret_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_insert_visit_on_customer_visits_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Registra se mudou (inclui aumento e diminuição)
  IF NEW.visits IS DISTINCT FROM OLD.visits THEN

    -- (Opcional, mas recomendado) só registra se já sabemos qual passe é o "atual"
    -- Se você preferir registrar mesmo assim, remova este IF e deixe inserir com NULL.
    IF NEW.user_pass_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.visits (
      project_id,
      customer_email,
      customer_google_sub,
      user_pass_id
      -- created_at fica no default (now())
    )
    VALUES (
      NEW.project_id,
      NEW.email,
      NEW.google_sub,
      NEW.user_pass_id
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_insert_visit_on_customer_visits_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_last_visit_on_points_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Só atualiza last_visit se o campo "points" realmente mudou
  if (old.metadata ->> 'points') is distinct from (new.metadata ->> 'points') then
    new.last_visit := now();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_last_visit_on_points_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_customer_from_user_passes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$DECLARE
  v_project_id uuid;
  v_google_sub text;
  v_name text;
  v_email text;
  v_visits integer;
BEGIN
  -- bypass RLS (desde que customers não esteja FORCE RLS)
  PERFORM set_config('row_security', 'off', true);

  -- Resolve project_id: usa o da user_passes, senão busca em passes
  v_project_id := COALESCE(
    NEW.project_id,
    (SELECT p.project_id FROM public.passes p WHERE p.id = NEW.pass_id)
  );

  -- Extrai google_sub (pode ser NULL em alguns eventos)
  v_google_sub := NULLIF(TRIM(COALESCE(
    NEW.metadata->>'google_sub',
    NEW.metadata#>>'{claim,google_sub}',
    ''
  )), '');

  -- ==========================
  -- 1) CASO REMOVED
  -- ==========================
  IF NEW.install_status = 'removed' THEN
    UPDATE public.customers c
       SET pass_status = 'removed',
           updated_at = now(),
           user_pass_id = CASE
             WHEN c.user_pass_id = NEW.id THEN NULL
             ELSE c.user_pass_id
           END
     WHERE c.user_pass_id = NEW.id;

    IF NOT FOUND AND v_project_id IS NOT NULL AND v_google_sub IS NOT NULL THEN
      UPDATE public.customers c
         SET pass_status = 'removed',
             updated_at = now(),
             user_pass_id = CASE
               WHEN c.user_pass_id = NEW.id THEN NULL
               ELSE c.user_pass_id
             END
       WHERE c.project_id = v_project_id
         AND c.google_sub = v_google_sub;
    END IF;

    RETURN NEW;
  END IF;

  -- ==========================
  -- 2) CASO NÃO INSTALLED
  -- ==========================
  IF NEW.install_status IS DISTINCT FROM 'installed' THEN
    RETURN NEW;
  END IF;

  -- Pega name/email do lugar certo
  v_name := NULLIF(TRIM(COALESCE(
    NEW.metadata->>'name',
    NEW.metadata#>>'{claim,name}',
    ''
  )), '');

  v_email := NULLIF(TRIM(COALESCE(
    NEW.metadata->>'email',
    NEW.metadata#>>'{claim,email}',
    ''
  )), '');

  -- Sem a chave única, não dá pra inserir customers
  IF v_project_id IS NULL OR v_google_sub IS NULL THEN
    RETURN NEW;
  END IF;

  -- ==========================
  -- ✅ NOVO: visits = soma dos points de todos os passes com o mesmo email
  -- (no mesmo projeto) e instalados
  -- ==========================
  SELECT COALESCE(SUM(points_int), 0)
    INTO v_visits
  FROM (
    SELECT
      CASE
        WHEN NULLIF(TRIM(COALESCE(
          up.metadata->>'points',
          up.metadata#>>'{claim,points}',
          ''
        )), '') ~ '^-?\d+$'
        THEN NULLIF(TRIM(COALESCE(
          up.metadata->>'points',
          up.metadata#>>'{claim,points}',
          ''
        )), '')::integer
        ELSE 0
      END AS points_int
    FROM public.user_passes up
    WHERE up.project_id = v_project_id
      AND up.install_status = 'installed'
      AND v_email IS NOT NULL
      AND lower(trim(COALESCE(
        up.metadata->>'email',
        up.metadata#>>'{claim,email}',
        ''
      ))) = lower(trim(v_email))
  ) s;

  INSERT INTO public.customers (
    project_id,
    google_sub,
    name,
    email,
    visits,
    pass_status,
    user_pass_id,
    created_at,
    updated_at
  )
  VALUES (
    v_project_id,
    v_google_sub,
    v_name,
    v_email,
    v_visits,
    NEW.install_status,         -- 'installed'
    NEW.id,
    COALESCE(NEW.installed_at, now()),
    now()
  )
  ON CONFLICT (project_id, google_sub)
  DO UPDATE SET
    name = COALESCE(EXCLUDED.name, public.customers.name),
    email = COALESCE(EXCLUDED.email, public.customers.email),

    -- ✅ sempre recalculado no evento installed (vira campo “derivado”)
    visits = EXCLUDED.visits,

    pass_status = EXCLUDED.pass_status,
    user_pass_id = EXCLUDED.user_pass_id,
    created_at = COALESCE(public.customers.created_at, EXCLUDED.created_at),
    updated_at = now();

  RETURN NEW;
END;$_$;


ALTER FUNCTION "public"."trg_sync_customer_from_user_passes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.wallet_links
  SET google_object_id = p_google_object_id,
      updated_at = now()
  WHERE id = p_wallet_link_id;

  RETURN jsonb_build_object('ok', true, 'wallet_link_id', p_wallet_link_id, 'google_object_id', p_google_object_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_dispatches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "automation_id" "uuid" NOT NULL,
    "user_pass_id" "uuid" NOT NULL,
    "reference_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_dispatches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'on'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "automations_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "automations_status_check" CHECK (("status" = ANY (ARRAY['on'::"text", 'off'::"text"]))),
    CONSTRAINT "automations_type_check" CHECK (("type" = ANY (ARRAY['points_wallet'::"text", 'expiring_soon'::"text", 'days_without_visit'::"text"])))
);


ALTER TABLE "public"."automations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "google_sub" "text" NOT NULL,
    "name" "text",
    "email" "text",
    "profile_pic" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" DEFAULT '0f9c8c77-3eaf-4dc7-b4b7-4bdbd6536b32'::"uuid" NOT NULL,
    "google_sub" "text" NOT NULL,
    "name" "text",
    "email" "text",
    "job_tag" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "avatar_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "visits" integer DEFAULT 0 NOT NULL,
    "pass_status" "text" DEFAULT 'installed'::"text" NOT NULL,
    "user_pass_id" "uuid"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "type" "text" NOT NULL,
    "value" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "events_type_check" CHECK (("type" = ANY (ARRAY['signup'::"text", 'visit'::"text", 'reward_unlocked'::"text", 'wallet_linked'::"text", 'note'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."function_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "function_name" "text" NOT NULL,
    "level" "text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."function_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "label" "text",
    "lat" numeric(9,6),
    "lng" numeric(9,6),
    "radius" integer DEFAULT 200 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "address" "text",
    "description" "text",
    CONSTRAINT "locations_lat_lng_range_chk" CHECK (((("lat" IS NULL) OR (("lat" >= ('-90'::integer)::numeric) AND ("lat" <= (90)::numeric))) AND (("lng" IS NULL) OR (("lng" >= ('-180'::integer)::numeric) AND ("lng" <= (180)::numeric)))))
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "cycle_start" "date" DEFAULT CURRENT_DATE NOT NULL,
    "cycle_end" "date" DEFAULT (CURRENT_DATE + 30) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "channels" "jsonb" NOT NULL,
    "trigger_type" "text" NOT NULL,
    "trigger_config" "jsonb",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "scheduled_for" timestamp with time zone,
    "sent_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL
);


ALTER TABLE "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orgs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."orgs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pass_locations" (
    "pass_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pass_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "project_id" "uuid" NOT NULL,
    "template_id" "text",
    "serial_number" "text" NOT NULL,
    "email" "text",
    "status" "text" DEFAULT 'issued'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text",
    "title" "text",
    "description" "text",
    "google_jwt" "text",
    "apple_url" "text",
    "qr_url" "text",
    "apple_pass_base64" "text",
    "design" "jsonb",
    "fields" "jsonb",
    "universal_url" "text",
    "short_code" "text",
    "short_code_expires_at" timestamp with time zone,
    CONSTRAINT "passes_type_check" CHECK (("type" = ANY (ARRAY['loyalty'::"text", 'coupon'::"text", 'event'::"text", 'boarding'::"text", 'offer'::"text", 'generic'::"text"])))
);


ALTER TABLE "public"."passes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passkit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb"
);


ALTER TABLE "public"."passkit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passkit_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_pass_id" "uuid" NOT NULL,
    "device_library_identifier" "text" NOT NULL,
    "push_token" "text" NOT NULL,
    "pass_type_identifier" "text" NOT NULL,
    "serial_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."passkit_registrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "name" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['superadmin'::"text", 'establishment'::"text", 'customer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'owner'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "project_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "wallet_address" "text" NOT NULL,
    "chain" "text" NOT NULL,
    "label" "text",
    "google_sub" "text",
    "google_email" "text",
    "google_name" "text",
    "google_picture" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "template_id" "text",
    "auth_mode" "text" DEFAULT 'google_only'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    "logo_url" "text",
    "extra_form_schema" "jsonb" DEFAULT '[]'::"jsonb",
    "pass_type" "text",
    "wallet_design" "jsonb",
    "field_mapping" "jsonb",
    "apple_template_id" "text",
    "google_template_id" "text",
    "wallet_template_id" "uuid",
    "slug" "text",
    CONSTRAINT "projects_auth_mode_check" CHECK (("auth_mode" = ANY (ARRAY['google_only'::"text", 'google_plus_form'::"text", 'form_only'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."auth_mode" IS 'Define o fluxo de cadastro: google_only, google_plus_form, form_only';



COMMENT ON COLUMN "public"."projects"."extra_form_schema" IS 'Define os campos customizados para o formulário de cadastro adicional.';



CREATE TABLE IF NOT EXISTS "public"."projects_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "notifications_limit" integer DEFAULT 0,
    "total_notifications_sent" bigint DEFAULT 0 NOT NULL,
    "notifications_exp" timestamp with time zone NOT NULL,
    "recent_notifications_sent" integer DEFAULT 0 NOT NULL,
    "notifications_remaining" integer GENERATED ALWAYS AS (
CASE
    WHEN ("notifications_limit" IS NULL) THEN NULL::integer
    ELSE ("notifications_limit" - "recent_notifications_sent")
END) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_notifications_notifications_limit_check" CHECK ((("notifications_limit" IS NULL) OR ("notifications_limit" >= 0))),
    CONSTRAINT "projects_notifications_recent_notifications_sent_check" CHECK (("recent_notifications_sent" >= 0)),
    CONSTRAINT "projects_notifications_total_notifications_sent_check" CHECK (("total_notifications_sent" >= 0))
);


ALTER TABLE "public"."projects_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."secrets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pass_token" "text" NOT NULL,
    "user_id" "uuid",
    "pass_type" "text" DEFAULT 'google'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "issued_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "pass_id" "uuid" NOT NULL,
    "install_status" "text" DEFAULT 'opened'::"text" NOT NULL,
    "installed_at" timestamp with time zone,
    "install_platform" "text",
    "removed_at" timestamp with time zone,
    "device_key" "text",
    "project_id" "uuid" NOT NULL,
    "google_object_id" "text",
    "google_class_id" "text",
    "last_visit" timestamp with time zone
);


ALTER TABLE "public"."user_passes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "address" "text" NOT NULL,
    "chain" "text" NOT NULL,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_wallets" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_passes" AS
 SELECT "id",
    "project_id",
    "type",
    "title",
    "description",
    "google_jwt",
    "apple_url",
    "qr_url",
    "universal_url",
    "status",
    "created_at"
   FROM "public"."passes" "p";


ALTER VIEW "public"."v_passes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "customer_email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "customer_google_sub" "text",
    "user_pass_id" "uuid"
);


ALTER TABLE "public"."visits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "apple_pass_type_id" "text",
    "apple_team_id" "text",
    "apple_key_id" "text",
    "google_issuer_id" "text",
    "google_class_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "card_title" "text",
    "reward_description" "text",
    "terms_and_conditions" "text",
    "background_color" character varying(7) DEFAULT '#7852ee'::character varying,
    "foreground_color" character varying(7) DEFAULT '#ffffff'::character varying,
    "label_color" character varying(7) DEFAULT '#ffffff'::character varying,
    "background_image_url" "text",
    "pass_template" "jsonb",
    "google_service_account_json" "text",
    "apple_private_key_p8" "text",
    "apple_private_key_password" "text",
    "google_service_account_path" "text",
    "apple_private_key_path" "text",
    "design" "jsonb",
    "default_google_class_id" "text",
    CONSTRAINT "wallet_configs_google_class_format_chk" CHECK ((("google_class_id" IS NULL) OR ((POSITION(('.'::"text") IN ("btrim"("google_class_id"))) > 0) AND ("split_part"("btrim"("google_class_id"), '.'::"text", 1) <> ''::"text") AND ("split_part"("btrim"("google_class_id"), '.'::"text", 2) <> ''::"text"))))
);


ALTER TABLE "public"."wallet_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_configs_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_config_id" "uuid",
    "project_id" "uuid" NOT NULL,
    "pass_template" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wallet_configs_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "google_object_id" "text",
    "apple_pass_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wallet_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" DEFAULT 'Default Wallet Template'::"text" NOT NULL,
    "defaults" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wallet_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "wallet"."issued_passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "template_id" "uuid",
    "member_id" "text",
    "fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "issued_passes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "wallet"."issued_passes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "wallet"."projects" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "wallet"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "wallet"."templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "design" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "templates_type_check" CHECK (("type" = ANY (ARRAY['loyalty'::"text", 'coupon'::"text", 'event'::"text", 'boarding'::"text"])))
);


ALTER TABLE "wallet"."templates" OWNER TO "postgres";


ALTER TABLE ONLY "public"."automation_dispatches"
    ADD CONSTRAINT "automation_dispatches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_dispatches"
    ADD CONSTRAINT "automation_dispatches_unique" UNIQUE ("automation_id", "user_pass_id", "reference_date");



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_google_sub_key" UNIQUE ("google_sub");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."function_logs"
    ADD CONSTRAINT "function_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_id_project_id_unique" UNIQUE ("id", "project_id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_states"
    ADD CONSTRAINT "loyalty_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_states"
    ADD CONSTRAINT "loyalty_states_project_id_customer_id_key" UNIQUE ("project_id", "customer_id");



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."orgs"
    ADD CONSTRAINT "orgs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pass_locations"
    ADD CONSTRAINT "pass_locations_pkey" PRIMARY KEY ("pass_id", "location_id");



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_id_project_id_unique" UNIQUE ("id", "project_id");



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_serial_number_key" UNIQUE ("serial_number");



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."passkit_events"
    ADD CONSTRAINT "passkit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passkit_registrations"
    ADD CONSTRAINT "passkit_registrations_device_library_identifier_serial_numb_key" UNIQUE ("device_library_identifier", "serial_number");



ALTER TABLE ONLY "public"."passkit_registrations"
    ADD CONSTRAINT "passkit_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."project_wallets"
    ADD CONSTRAINT "project_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects_notifications"
    ADD CONSTRAINT "projects_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects_notifications"
    ADD CONSTRAINT "projects_notifications_project_id_key" UNIQUE ("project_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."secrets"
    ADD CONSTRAINT "secrets_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."secrets"
    ADD CONSTRAINT "secrets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_passes"
    ADD CONSTRAINT "user_passes_pass_id_pass_token_unique" UNIQUE ("pass_id", "pass_token");



ALTER TABLE ONLY "public"."user_passes"
    ADD CONSTRAINT "user_passes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_user_id_address_chain_key" UNIQUE ("user_id", "address", "chain");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_configs_history"
    ADD CONSTRAINT "wallet_configs_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_configs"
    ADD CONSTRAINT "wallet_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_links"
    ADD CONSTRAINT "wallet_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_templates"
    ADD CONSTRAINT "wallet_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "wallet"."issued_passes"
    ADD CONSTRAINT "issued_passes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "wallet"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "wallet"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");



CREATE INDEX "automation_dispatches_automation_idx" ON "public"."automation_dispatches" USING "btree" ("automation_id");



CREATE INDEX "automation_dispatches_user_pass_idx" ON "public"."automation_dispatches" USING "btree" ("user_pass_id");



CREATE INDEX "automations_project_id_idx" ON "public"."automations" USING "btree" ("project_id");



CREATE INDEX "automations_project_status_idx" ON "public"."automations" USING "btree" ("project_id", "status");



CREATE INDEX "automations_status_idx" ON "public"."automations" USING "btree" ("status");



CREATE INDEX "automations_type_idx" ON "public"."automations" USING "btree" ("type");



CREATE UNIQUE INDEX "customers_project_id_google_sub_idx" ON "public"."customers" USING "btree" ("project_id", "google_sub");



CREATE INDEX "events_project_id_at_idx" ON "public"."events" USING "btree" ("project_id", "at" DESC);



CREATE INDEX "idx_customers_project_google_sub" ON "public"."customers" USING "btree" ("project_id", "google_sub");



CREATE INDEX "idx_customers_user_pass_id" ON "public"."customers" USING "btree" ("user_pass_id");



CREATE INDEX "idx_loyalty_states_project_customer" ON "public"."loyalty_states" USING "btree" ("project_id", "customer_id");



CREATE INDEX "idx_passes_project_id_created_at" ON "public"."passes" USING "btree" ("project_id", "created_at");



CREATE INDEX "idx_project_members_user_id" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "idx_project_wallets_google_sub" ON "public"."project_wallets" USING "btree" ("google_sub");



CREATE INDEX "idx_project_wallets_project_id" ON "public"."project_wallets" USING "btree" ("project_id");



CREATE INDEX "idx_project_wallets_wallet_address" ON "public"."project_wallets" USING "btree" ("wallet_address");



CREATE INDEX "idx_projects_notifications_exp" ON "public"."projects_notifications" USING "btree" ("notifications_exp");



CREATE INDEX "idx_projects_notifications_project_id" ON "public"."projects_notifications" USING "btree" ("project_id");



CREATE UNIQUE INDEX "idx_unique_project_user" ON "public"."project_members" USING "btree" ("project_id", "user_id");



CREATE UNIQUE INDEX "idx_unique_wallet_templates_project_id" ON "public"."wallet_templates" USING "btree" ("project_id");



CREATE INDEX "idx_visits_pass_token" ON "public"."visits" USING "btree" ("customer_google_sub");



CREATE INDEX "idx_visits_project_created_at" ON "public"."visits" USING "btree" ("project_id", "created_at");



CREATE INDEX "idx_visits_project_user_pass_created_at" ON "public"."visits" USING "btree" ("project_id", "user_pass_id", "created_at" DESC);



CREATE INDEX "idx_visits_user_pass_id_created_at" ON "public"."visits" USING "btree" ("user_pass_id", "created_at" DESC);



CREATE INDEX "locations_project_active_priority_idx" ON "public"."locations" USING "btree" ("project_id", "is_active", "priority", "created_at");



CREATE INDEX "locations_project_id_idx" ON "public"."locations" USING "btree" ("project_id");



CREATE INDEX "notification_jobs_pick_idx" ON "public"."notification_jobs" USING "btree" ("status", "available_at", "scheduled_for", "priority", "created_at");



CREATE INDEX "notification_jobs_project_created_idx" ON "public"."notification_jobs" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "notification_jobs_project_customer_idx" ON "public"."notification_jobs" USING "btree" ("project_id", "customer_id", "created_at" DESC);



CREATE UNIQUE INDEX "notification_jobs_project_idem_unique" ON "public"."notification_jobs" USING "btree" ("project_id", "idempotency_key");



CREATE INDEX "notification_jobs_project_notification_idx" ON "public"."notification_jobs" USING "btree" ("project_id", "notification_id", "created_at" DESC);



CREATE INDEX "notifications_project_created_idx" ON "public"."notifications" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "notifications_project_scheduled_idx" ON "public"."notifications" USING "btree" ("project_id", "scheduled_for");



CREATE INDEX "notifications_project_status_idx" ON "public"."notifications" USING "btree" ("project_id", "status");



CREATE INDEX "pass_locations_location_id_idx" ON "public"."pass_locations" USING "btree" ("location_id");



CREATE INDEX "pass_locations_pass_id_idx" ON "public"."pass_locations" USING "btree" ("pass_id");



CREATE INDEX "pass_locations_project_id_idx" ON "public"."pass_locations" USING "btree" ("project_id");



CREATE INDEX "pass_locations_project_location_idx" ON "public"."pass_locations" USING "btree" ("project_id", "location_id");



CREATE UNIQUE INDEX "passes_short_code_idx" ON "public"."passes" USING "btree" ("short_code");



CREATE UNIQUE INDEX "project_members_project_user_key" ON "public"."project_members" USING "btree" ("project_id", "user_id");



CREATE UNIQUE INDEX "uq_customers_project_sub" ON "public"."customers" USING "btree" ("project_id", "google_sub");



CREATE UNIQUE INDEX "uq_project_members_project_user" ON "public"."project_members" USING "btree" ("project_id", "user_id");



CREATE UNIQUE INDEX "uq_wallet_links_apple_pass" ON "public"."wallet_links" USING "btree" ("apple_pass_id") WHERE ("apple_pass_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_wallet_links_google_object" ON "public"."wallet_links" USING "btree" ("google_object_id") WHERE ("google_object_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_wallet_links_project_customer" ON "public"."wallet_links" USING "btree" ("project_id", "customer_id");



CREATE INDEX "user_passes_pass_id_idx" ON "public"."user_passes" USING "btree" ("pass_id");



CREATE INDEX "user_passes_pass_id_project_id_idx" ON "public"."user_passes" USING "btree" ("pass_id", "project_id");



CREATE UNIQUE INDEX "user_passes_pass_token_uniq" ON "public"."user_passes" USING "btree" ("pass_token");



CREATE UNIQUE INDEX "user_passes_project_device_uniq" ON "public"."user_passes" USING "btree" ("pass_id", "device_key");



CREATE INDEX "user_passes_user_id_idx" ON "public"."user_passes" USING "btree" ("user_id");



CREATE UNIQUE INDEX "wallet_templates_project_id_key" ON "public"."wallet_templates" USING "btree" ("project_id");



CREATE UNIQUE INDEX "wallet_templates_project_idx" ON "public"."wallet_templates" USING "btree" ("project_id") WHERE ("project_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "customers_insert_visit_on_visits_change" AFTER UPDATE OF "visits" ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."trg_insert_visit_on_customer_visits_change"();



CREATE OR REPLACE TRIGGER "trg_loyalty_states_set_updated_at" BEFORE UPDATE ON "public"."loyalty_states" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notification_jobs_updated_at" BEFORE UPDATE ON "public"."notification_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_passes_set_last_visit_on_points_change" BEFORE UPDATE OF "metadata" ON "public"."user_passes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_last_visit_on_points_change"();



CREATE OR REPLACE TRIGGER "user_passes_sync_customer" AFTER INSERT OR UPDATE OF "install_status", "installed_at", "metadata", "project_id" ON "public"."user_passes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_customer_from_user_passes"();



CREATE OR REPLACE TRIGGER "wallet_config_update_trigger" AFTER UPDATE ON "public"."wallet_configs" FOR EACH ROW WHEN (("old"."pass_template" IS DISTINCT FROM "new"."pass_template")) EXECUTE FUNCTION "public"."log_wallet_config_change"();



ALTER TABLE ONLY "public"."automation_dispatches"
    ADD CONSTRAINT "automation_dispatches_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_dispatches"
    ADD CONSTRAINT "automation_dispatches_user_pass_id_fkey" FOREIGN KEY ("user_pass_id") REFERENCES "public"."user_passes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_pass_id_fkey" FOREIGN KEY ("user_pass_id") REFERENCES "public"."user_passes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_states"
    ADD CONSTRAINT "loyalty_states_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_states"
    ADD CONSTRAINT "loyalty_states_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_jobs"
    ADD CONSTRAINT "notification_jobs_user_pass_id_fkey" FOREIGN KEY ("user_pass_id") REFERENCES "public"."user_passes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orgs"
    ADD CONSTRAINT "orgs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pass_locations"
    ADD CONSTRAINT "pass_locations_location_fkey" FOREIGN KEY ("location_id", "project_id") REFERENCES "public"."locations"("id", "project_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pass_locations"
    ADD CONSTRAINT "pass_locations_pass_fkey" FOREIGN KEY ("pass_id", "project_id") REFERENCES "public"."passes"("id", "project_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pass_locations"
    ADD CONSTRAINT "pass_locations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."passes"
    ADD CONSTRAINT "passes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."passkit_registrations"
    ADD CONSTRAINT "passkit_registrations_user_pass_id_fkey" FOREIGN KEY ("user_pass_id") REFERENCES "public"."user_passes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_wallets"
    ADD CONSTRAINT "project_wallets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects_notifications"
    ADD CONSTRAINT "projects_notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_passes"
    ADD CONSTRAINT "user_passes_pass_project_fkey" FOREIGN KEY ("pass_id", "project_id") REFERENCES "public"."passes"("id", "project_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_user_pass_id_fkey" FOREIGN KEY ("user_pass_id") REFERENCES "public"."user_passes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_configs_history"
    ADD CONSTRAINT "wallet_configs_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_configs_history"
    ADD CONSTRAINT "wallet_configs_history_wallet_config_id_fkey" FOREIGN KEY ("wallet_config_id") REFERENCES "public"."wallet_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_configs"
    ADD CONSTRAINT "wallet_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_links"
    ADD CONSTRAINT "wallet_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_links"
    ADD CONSTRAINT "wallet_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_templates"
    ADD CONSTRAINT "wallet_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "wallet"."issued_passes"
    ADD CONSTRAINT "issued_passes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "wallet"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "wallet"."issued_passes"
    ADD CONSTRAINT "issued_passes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "wallet"."templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "wallet"."templates"
    ADD CONSTRAINT "templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "wallet"."projects"("id") ON DELETE CASCADE;



CREATE POLICY "Allow admins" ON "public"."wallet_configs" USING ("public"."is_superadmin"());



CREATE POLICY "Allow anonymous insert on customers" ON "public"."customers" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Allow anonymous read on customers" ON "public"."customers" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow authenticated read access" ON "public"."projects" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow inserts for service role" ON "public"."customers" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Allow selects for service role" ON "public"."customers" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Allow service role to delete projects" ON "public"."projects" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "Allow service role to update projects" ON "public"."projects" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow superadmins to delete projects" ON "public"."projects" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());



CREATE POLICY "Allow superadmins to insert projects" ON "public"."projects" FOR INSERT TO "authenticated", "service_role" WITH CHECK ("public"."is_superadmin"());



CREATE POLICY "Allow superadmins to update projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());



CREATE POLICY "Allow_menagement_for_fellow_project_members" ON "public"."project_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Authenticated users can create orgs." ON "public"."orgs" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Customers can view their own loyalty state." ON "public"."loyalty_states" FOR SELECT USING (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."google_sub" = ("auth"."jwt"() ->> 'sub'::"text")))));



CREATE POLICY "Deny all by default" ON "public"."passes" USING (false);



CREATE POLICY "Enable read access for project members" ON "public"."wallet_configs_history" FOR SELECT USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "Full access for service_role" ON "public"."customers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Members can read their projects" ON "public"."projects" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "projects"."id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Negar tudo por padrão" ON "public"."passes" USING (false) WITH CHECK (false);



CREATE POLICY "Org admins can manage members" ON "public"."org_members" USING (("public"."is_superadmin"() OR "public"."is_org_admin"("auth"."uid"(), "org_id")));



CREATE POLICY "Org members can view other members" ON "public"."org_members" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of_org"("auth"."uid"(), "org_id")));



CREATE POLICY "Org owners can update their org." ON "public"."orgs" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Owners and members can view their org." ON "public"."orgs" FOR SELECT USING (("id" IN ( SELECT "org_members"."org_id"
   FROM "public"."org_members"
  WHERE ("org_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Public read access to wallet configs" ON "public"."wallet_configs" FOR SELECT USING (true);



CREATE POLICY "Superadmin can read all projects" ON "public"."projects" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "pr"
  WHERE (("pr"."id" = "auth"."uid"()) AND ("pr"."role" = 'superadmin'::"text")))));



CREATE POLICY "Users can delete their own wallets" ON "public"."user_wallets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own wallets" ON "public"."user_wallets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile." ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own profile." ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own wallets" ON "public"."user_wallets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "anon read wallet_configs" ON "public"."wallet_configs" FOR SELECT USING (true);



CREATE POLICY "apenas logado pode criar/atualizar templates" ON "public"."wallet_templates" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "clientes_insert" ON "public"."customers" FOR INSERT WITH CHECK (true);



CREATE POLICY "clientes_select" ON "public"."customers" FOR SELECT USING (("google_sub" = ("auth"."jwt"() ->> 'sub'::"text")));



CREATE POLICY "clientes_update" ON "public"."customers" FOR UPDATE USING (true);



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cust_del" ON "public"."customers" FOR DELETE TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "cust_ins" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "cust_read" ON "public"."customers" FOR SELECT TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "cust_upd" ON "public"."customers" FOR UPDATE TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id"))) WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers member read" ON "public"."customers" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of"("project_id")));



CREATE POLICY "customers_insert_member" ON "public"."customers" FOR INSERT WITH CHECK ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



CREATE POLICY "customers_rw" ON "public"."customers" TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "customers"."project_id") AND ("m"."user_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "customers"."project_id") AND ("m"."user_id" = "auth"."uid"()))))));



CREATE POLICY "customers_select_member" ON "public"."customers" FOR SELECT USING ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



CREATE POLICY "customers_update_member" ON "public"."customers" FOR UPDATE USING ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id")) WITH CHECK ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events member read" ON "public"."events" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of"("project_id")));



CREATE POLICY "events_ins" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "events_read" ON "public"."events" FOR SELECT TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "events_rw" ON "public"."events" TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "events"."project_id") AND ("m"."user_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "events"."project_id") AND ("m"."user_id" = "auth"."uid"()))))));



CREATE POLICY "loc_del" ON "public"."locations" FOR DELETE TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "loc_delete" ON "public"."locations" FOR DELETE TO "authenticated" USING ("public"."is_member_of_project"("project_id"));



CREATE POLICY "loc_ins" ON "public"."locations" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "loc_insert" ON "public"."locations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of_project"("project_id"));



CREATE POLICY "loc_read" ON "public"."locations" FOR SELECT TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "loc_upd" ON "public"."locations" FOR UPDATE TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"())) WITH CHECK (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "loc_update" ON "public"."locations" FOR UPDATE TO "authenticated" USING ("public"."is_member_of_project"("project_id")) WITH CHECK ("public"."is_member_of_project"("project_id"));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_delete" ON "public"."locations" FOR DELETE TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "locations"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"text"))))));



CREATE POLICY "locations_insert" ON "public"."locations" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "locations"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"text"))))));



CREATE POLICY "locations_rw" ON "public"."locations" TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"())) WITH CHECK (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "locations_select" ON "public"."locations" FOR SELECT TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "locations"."project_id") AND ("pm"."user_id" = "auth"."uid"()))))));



CREATE POLICY "locations_update" ON "public"."locations" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "locations"."project_id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = 'owner'::"text"))))));



CREATE POLICY "loyalty member read" ON "public"."loyalty_states" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of"("project_id")));



ALTER TABLE "public"."loyalty_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_states_member_select" ON "public"."loyalty_states" FOR SELECT USING ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



CREATE POLICY "loyalty_states_member_update" ON "public"."loyalty_states" FOR UPDATE USING ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id")) WITH CHECK ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



CREATE POLICY "loyalty_states_rw" ON "public"."loyalty_states" TO "authenticated" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"())) WITH CHECK (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



CREATE POLICY "loyalty_states_select" ON "public"."loyalty_states" FOR SELECT USING (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."google_sub" = ("auth"."jwt"() ->> 'sub'::"text")))));



CREATE POLICY "ls_rw" ON "public"."loyalty_states" TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "loyalty_states"."project_id") AND ("m"."user_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "loyalty_states"."project_id") AND ("m"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."notification_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_jobs_insert_project_staff" ON "public"."notification_jobs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_project_staff"("project_id"));



CREATE POLICY "notification_jobs_select_project_staff" ON "public"."notification_jobs" FOR SELECT TO "authenticated" USING ("public"."is_project_staff"("project_id"));



CREATE POLICY "notifications_insert_project_staff" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_project_staff"("project_id"));



CREATE POLICY "notifications_select_project_staff" ON "public"."notifications" FOR SELECT TO "authenticated" USING ("public"."is_project_staff"("project_id"));



ALTER TABLE "public"."org_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orgs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."passes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "passes_select_all_auth" ON "public"."passes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pm member read" ON "public"."project_members" FOR SELECT USING (("public"."is_superadmin"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "pm superadmin del" ON "public"."project_members" FOR DELETE USING ("public"."is_superadmin"());



CREATE POLICY "pm superadmin ins" ON "public"."project_members" FOR INSERT WITH CHECK ("public"."is_superadmin"());



CREATE POLICY "pm superadmin upd" ON "public"."project_members" FOR UPDATE USING ("public"."is_superadmin"());



CREATE POLICY "pm_cud" ON "public"."project_members" TO "authenticated" USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());



CREATE POLICY "pm_del" ON "public"."project_members" FOR DELETE TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "pm_ins" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "pm_read" ON "public"."project_members" FOR SELECT TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "pm_read" ON "public"."project_wallets" FOR SELECT USING (("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "pm_select" ON "public"."project_members" FOR SELECT TO "authenticated" USING (("public"."is_superadmin"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "pm_upd" ON "public"."project_members" FOR UPDATE TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id"))) WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_auth" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_self_view" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "qualquer um pode ler templates" ON "public"."wallet_templates" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_passes_owner_delete" ON "public"."user_passes" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_passes_owner_insert" ON "public"."user_passes" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_passes_owner_select" ON "public"."user_passes" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_passes_owner_update" ON "public"."user_passes" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_passes_select_project_member" ON "public"."user_passes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."passes" "p"
  WHERE (("p"."id" = "user_passes"."pass_id") AND "public"."is_member_of_project"("auth"."uid"(), "p"."project_id")))));



ALTER TABLE "public"."user_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visits_insert_member" ON "public"."visits" FOR INSERT WITH CHECK ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



CREATE POLICY "visits_insert_service" ON "public"."visits" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_pass_belongs_to_current_user_by_token"("customer_google_sub"));



CREATE POLICY "visits_select_member" ON "public"."visits" FOR SELECT USING ("public"."is_member_of_project"(( SELECT "auth"."uid"() AS "uid"), "project_id"));



ALTER TABLE "public"."wallet_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallet_configs_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_configs_member_insert" ON "public"."wallet_configs" FOR INSERT WITH CHECK (true);



CREATE POLICY "wallet_configs_member_select" ON "public"."wallet_configs" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_configs_member_update" ON "public"."wallet_configs" FOR UPDATE USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id"))) WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_configs_select" ON "public"."wallet_configs" FOR SELECT USING (true);



CREATE POLICY "wallet_cud" ON "public"."wallet_configs" USING ("public"."is_superadmin"());



CREATE POLICY "wallet_ins" ON "public"."wallet_configs" FOR INSERT WITH CHECK (true);



CREATE POLICY "wallet_insert" ON "public"."wallet_configs" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."wallet_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_links member read" ON "public"."wallet_links" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of"("project_id")));



CREATE POLICY "wallet_links_member_insert" ON "public"."wallet_links" FOR INSERT WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_links_member_read" ON "public"."wallet_links" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_links_member_select" ON "public"."wallet_links" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



ALTER TABLE "public"."wallet_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_templates_delete" ON "public"."wallet_templates" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());



CREATE POLICY "wallet_templates_insert" ON "public"."wallet_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_templates_select" ON "public"."wallet_templates" FOR SELECT USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_templates_update" ON "public"."wallet_templates" FOR UPDATE TO "authenticated" USING (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id"))) WITH CHECK (("public"."is_superadmin"() OR "public"."is_member_of_project"("project_id")));



CREATE POLICY "wallet_update_superadmin" ON "public"."wallet_configs" FOR UPDATE USING ("public"."is_superadmin"());



CREATE POLICY "wallet_upsert" ON "public"."wallet_configs" FOR INSERT WITH CHECK (true);



CREATE POLICY "wallet_upsert_superadmin" ON "public"."wallet_configs" FOR INSERT WITH CHECK (true);



CREATE POLICY "wl_rw" ON "public"."wallet_links" TO "authenticated" USING (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "wallet_links"."project_id") AND ("m"."user_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "m"
  WHERE (("m"."project_id" = "wallet_links"."project_id") AND ("m"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Allow_access_to_own_project_members_templates" ON "wallet"."templates" USING (("public"."is_member_of_project"("project_id") OR "public"."is_superadmin"()));



ALTER TABLE "wallet"."issued_passes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public read templates" ON "wallet"."templates" FOR SELECT TO "anon" USING (true);



ALTER TABLE "wallet"."templates" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."check_and_increment_notifications"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_increment_notifications"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_increment_notifications"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."notification_jobs" TO "anon";
GRANT ALL ON TABLE "public"."notification_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_notification_jobs"("p_limit" integer, "p_worker" "text", "p_lock_timeout_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_notification_jobs"("p_limit" integer, "p_worker" "text", "p_lock_timeout_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_notification_jobs"("p_limit" integer, "p_worker" "text", "p_lock_timeout_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_automation_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_automation_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_automation_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_find_user_id"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_find_user_id"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_find_user_id"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_global_kpis"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_global_kpis"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_global_kpis"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_global_kpis_timeseries"("p_months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_global_kpis_timeseries"("p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_global_kpis_timeseries"("p_months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_project_analytics"("p_project_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_project_analytics"("p_project_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_project_analytics"("p_project_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_project_kpis"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_timeseries"("p_project_id" "uuid", "p_months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_timeseries"("p_project_id" "uuid", "p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_timeseries"("p_project_id" "uuid", "p_months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_v2"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_v2"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_project_kpis_v2"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_stats"("p_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_stats"("p_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_stats"("p_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_stats_all"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_stats_all"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_stats_all"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_issuer_from_class"("p_class_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_issuer_from_class"("p_class_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_issuer_from_class"("p_class_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_link_member_by_email"("p_email" "text", "p_project" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_list_customers_with_visits"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_list_customers_with_visits"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_list_customers_with_visits"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_list_members"("p_project" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_list_members"("p_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_list_members"("p_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_list_members"("p_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_list_visits"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_list_visits"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_list_visits"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_scanner_visit"("p_project" "uuid", "p_google_sub" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_scanner_visit"("p_project" "uuid", "p_google_sub" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_scanner_visit"("p_project" "uuid", "p_google_sub" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_upsert_customer"("p_project" "uuid", "p_google_sub" "text", "p_email" "text", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_upsert_customer"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text", "p_avatar_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_upsert_customer"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text", "p_avatar_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_upsert_customer"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text", "p_avatar_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_upsert_customer_v2"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_upsert_customer_v2"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_upsert_customer_v2"("p_project_id" "uuid", "p_google_sub" "text", "p_name" "text", "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pass_owner"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_wallet_link_and_customer_points"("p_project_id" "uuid", "p_google_sub" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_wallet_link_and_customer_points"("p_project_id" "uuid", "p_google_sub" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_wallet_link_and_customer_points"("p_project_id" "uuid", "p_google_sub" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("p_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("p_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("p_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_org"("p_user_id" "uuid", "p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of_org"("p_user_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_org"("p_user_id" "uuid", "p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_member_of_project"("p_project" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_member_of_project"("p_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of_project"("p_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_project"("p_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_project"("p_user" "uuid", "p_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_pass_belongs_to_current_user_by_token"("token_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_staff"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_staff"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_staff"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_superadmin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_wallet_config_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_wallet_config_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_wallet_config_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_multiple_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_multiple_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_multiple_sessions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."read_secret"("secret_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."read_secret"("secret_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."read_secret"("secret_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_insert_visit_on_customer_visits_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_insert_visit_on_customer_visits_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_insert_visit_on_customer_visits_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_last_visit_on_points_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_last_visit_on_points_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_last_visit_on_points_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sync_customer_from_user_passes"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_customer_from_user_passes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_customer_from_user_passes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_wallet_link_google_object_id"("p_wallet_link_id" "uuid", "p_google_object_id" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."automation_dispatches" TO "anon";
GRANT ALL ON TABLE "public"."automation_dispatches" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_dispatches" TO "service_role";



GRANT ALL ON TABLE "public"."automations" TO "anon";
GRANT ALL ON TABLE "public"."automations" TO "authenticated";
GRANT ALL ON TABLE "public"."automations" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."function_logs" TO "anon";
GRANT ALL ON TABLE "public"."function_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."function_logs" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_states" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_states" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_states" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."org_members" TO "anon";
GRANT ALL ON TABLE "public"."org_members" TO "authenticated";
GRANT ALL ON TABLE "public"."org_members" TO "service_role";



GRANT ALL ON TABLE "public"."orgs" TO "anon";
GRANT ALL ON TABLE "public"."orgs" TO "authenticated";
GRANT ALL ON TABLE "public"."orgs" TO "service_role";



GRANT ALL ON TABLE "public"."pass_locations" TO "anon";
GRANT ALL ON TABLE "public"."pass_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."pass_locations" TO "service_role";



GRANT ALL ON TABLE "public"."passes" TO "anon";
GRANT ALL ON TABLE "public"."passes" TO "authenticated";
GRANT ALL ON TABLE "public"."passes" TO "service_role";



GRANT ALL ON TABLE "public"."passkit_events" TO "anon";
GRANT ALL ON TABLE "public"."passkit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."passkit_events" TO "service_role";



GRANT ALL ON TABLE "public"."passkit_registrations" TO "anon";
GRANT ALL ON TABLE "public"."passkit_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."passkit_registrations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_wallets" TO "anon";
GRANT ALL ON TABLE "public"."project_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."project_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."projects_notifications" TO "anon";
GRANT ALL ON TABLE "public"."projects_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."projects_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."secrets" TO "anon";
GRANT ALL ON TABLE "public"."secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."secrets" TO "service_role";



GRANT ALL ON TABLE "public"."user_passes" TO "anon";
GRANT ALL ON TABLE "public"."user_passes" TO "authenticated";
GRANT ALL ON TABLE "public"."user_passes" TO "service_role";



GRANT ALL ON TABLE "public"."user_wallets" TO "anon";
GRANT ALL ON TABLE "public"."user_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."v_passes" TO "anon";
GRANT ALL ON TABLE "public"."v_passes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_passes" TO "service_role";



GRANT ALL ON TABLE "public"."visits" TO "anon";
GRANT ALL ON TABLE "public"."visits" TO "authenticated";
GRANT ALL ON TABLE "public"."visits" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_configs" TO "anon";
GRANT ALL ON TABLE "public"."wallet_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_configs" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_configs_history" TO "anon";
GRANT ALL ON TABLE "public"."wallet_configs_history" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_configs_history" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_links" TO "anon";
GRANT ALL ON TABLE "public"."wallet_links" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_links" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_templates" TO "anon";
GRANT ALL ON TABLE "public"."wallet_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_templates" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop policy "qualquer um pode ler templates" on "public"."wallet_templates";


  create policy "qualquer um pode ler templates"
  on "public"."wallet_templates"
  as permissive
  for select
  to anon, authenticated
using (true);


CREATE TRIGGER single_session_per_user BEFORE INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.prevent_multiple_sessions();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "logos_auth_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'project-logos'::text));



  create policy "logos_auth_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'project-logos'::text))
with check ((bucket_id = 'project-logos'::text));



  create policy "logos_auth_upload"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'project-logos'::text));



  create policy "logos_owner_write"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'project-logos'::text) AND (auth.uid() = owner)))
with check (((bucket_id = 'project-logos'::text) AND (auth.uid() = owner)));



  create policy "logos_public_read"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'project-logos'::text));



  create policy "pass-assets read (public)"
  on "storage"."objects"
  as permissive
  for select
  to anon
using ((bucket_id = 'pass-assets'::text));



  create policy "pass-assets update (authenticated)"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'pass-assets'::text));



  create policy "pass-assets upload (authenticated)"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'pass-assets'::text));



  create policy "pass_assets_member_insert"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'pass-assets'::text) AND public.is_member_of_project(((string_to_array(name, '/'::text))[1])::uuid)));



  create policy "pass_assets_public_read"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'pass-assets'::text));



  create policy "secrets_owner_access"
  on "storage"."objects"
  as permissive
  for all
  to authenticated
using (((bucket_id = 'secrets'::text) AND public.is_superadmin()));



