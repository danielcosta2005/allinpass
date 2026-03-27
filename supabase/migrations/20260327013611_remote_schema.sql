drop extension if exists "pg_cron";

drop extension if exists "pg_net";

drop policy "Allow_access_to_own_project_members_templates" on "wallet"."templates";

drop policy "public read templates" on "wallet"."templates";

drop policy "qualquer um pode ler templates" on "public"."wallet_templates";

alter table "wallet"."issued_passes" drop constraint "issued_passes_project_id_fkey";

alter table "wallet"."issued_passes" drop constraint "issued_passes_status_check";

alter table "wallet"."issued_passes" drop constraint "issued_passes_template_id_fkey";

alter table "wallet"."templates" drop constraint "templates_project_id_fkey";

alter table "wallet"."templates" drop constraint "templates_type_check";

alter table "wallet"."issued_passes" drop constraint "issued_passes_pkey";

alter table "wallet"."projects" drop constraint "projects_pkey";

alter table "wallet"."templates" drop constraint "templates_pkey";

drop index if exists "wallet"."issued_passes_pkey";

drop index if exists "wallet"."projects_pkey";

drop index if exists "wallet"."templates_pkey";

drop table "wallet"."issued_passes";

drop table "wallet"."projects";

drop table "wallet"."templates";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fn_get_global_kpis()
 RETURNS TABLE(projects integer, customers integer, visits integer, rewards_unlocked integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select
    (select count(*) from public.projects)::integer as projects,
    (select count(distinct c.id) from public.customers c)::integer as customers,
    (select count(*) from public.events e where e.type='visit')::integer as visits,
    (select count(*) from public.events e where e.type='reward_unlocked')::integer as rewards_unlocked;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_global_kpis_timeseries(p_months integer)
 RETURNS TABLE(month date, visits integer, rewards integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_project_analytics(p_project_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_project_kpis(p_project_id uuid)
 RETURNS TABLE(active_customers bigint, visits_this_cycle bigint, rewards_unlocked bigint, wallet_linked bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    (SELECT count(DISTINCT c.id) FROM public.customers c WHERE c.project_id = p_project_id) as active_customers,
    (SELECT count(v.*) FROM public.visits v WHERE v.project_id = p_project_id AND v.created_at >= (CURRENT_DATE - INTERVAL '30 days')) as visits_this_cycle,
    (SELECT count(e.*) FROM public.events e WHERE e.project_id = p_project_id AND e.type = 'reward_unlocked') as rewards_unlocked,
    (SELECT count(wl.*) FROM public.wallet_links wl WHERE wl.project_id = p_project_id) as wallet_linked;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_project_kpis_timeseries(p_project_id uuid, p_months integer)
 RETURNS TABLE(month date, visits integer, rewards_unlocked integer, wallet_linked integer)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_project_kpis_v2(p_project_id uuid)
 RETURNS TABLE(active_customers integer, visits_this_cycle integer, rewards_unlocked integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    (SELECT COUNT(*) FROM public.customers c WHERE c.project_id = p_project_id) AS active_customers,
    (SELECT COUNT(*) FROM public.visits v WHERE v.project_id = p_project_id AND v.created_at >= (CURRENT_DATE - INTERVAL '30 days')) AS visits_this_cycle,
    (SELECT COUNT(*) FROM public.loyalty_states l WHERE l.project_id = p_project_id AND l.points >= 10) AS rewards_unlocked;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_stats(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_issuer_from_class(p_class_id text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT split_part(btrim(p_class_id), '.', 1)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_link_member_by_email(p_email text, p_project uuid, p_role text DEFAULT 'staff'::text)
 RETURNS TABLE(ok boolean, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_list_members(p_project uuid)
 RETURNS TABLE(user_id uuid, email text, role text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    pm.user_id,
    (select u.email from auth.users u where u.id = pm.user_id)::text as email,
    pm.role::text,
    pm.created_at
  from public.project_members pm
  where pm.project_id = p_project
  order by pm.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_scanner_visit(p_project uuid, p_google_sub text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_upsert_customer(p_project uuid, p_google_sub text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_upsert_customer(p_project_id uuid, p_google_sub text, p_name text, p_email text, p_avatar_url text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_pass_owner(p_token text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT user_id FROM public.user_passes WHERE pass_token = p_token LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_wallet_link_and_customer_points(p_project_id uuid, p_google_sub text)
 RETURNS TABLE(wallet_link_id uuid, google_object_id text, customer_id uuid, points integer, cycle_start date, cycle_end date, last_visit_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of(p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project AND pm.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_org(p_user_id uuid, p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_project(p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_project(p_user uuid, p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = p_user AND pm.project_id = p_project);
$function$
;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_user_id uuid, p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_pass_belongs_to_current_user_by_token(token_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM user_passes up
    WHERE up.pass_token = token_text
      AND up.user_id = (SELECT auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin');
$function$
;

CREATE OR REPLACE FUNCTION public.log_wallet_config_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    BEGIN
        INSERT INTO public.wallet_configs_history (wallet_config_id, project_id, pass_template, reason)
        VALUES (NEW.id, NEW.project_id, NEW.pass_template, 'config_update');
        RETURN NEW;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.update_wallet_link_google_object_id(p_wallet_link_id uuid, p_google_object_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.wallet_links
  SET google_object_id = p_google_object_id,
      updated_at = now()
  WHERE id = p_wallet_link_id;

  RETURN jsonb_build_object('ok', true, 'wallet_link_id', p_wallet_link_id, 'google_object_id', p_google_object_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$
;


  create policy "qualquer um pode ler templates"
  on "public"."wallet_templates"
  as permissive
  for select
  to authenticated, anon
using (true);


drop schema if exists "wallet";

drop trigger if exists "single_session_per_user" on "auth"."sessions";

drop trigger if exists "on_auth_user_created" on "auth"."users";

drop policy "logos_auth_insert" on "storage"."objects";

drop policy "logos_auth_update" on "storage"."objects";

drop policy "logos_auth_upload" on "storage"."objects";

drop policy "logos_owner_write" on "storage"."objects";

drop policy "logos_public_read" on "storage"."objects";

drop policy "pass-assets read (public)" on "storage"."objects";

drop policy "pass-assets update (authenticated)" on "storage"."objects";

drop policy "pass-assets upload (authenticated)" on "storage"."objects";

drop policy "pass_assets_member_insert" on "storage"."objects";

drop policy "pass_assets_public_read" on "storage"."objects";

drop policy "secrets_owner_access" on "storage"."objects";


