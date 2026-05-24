-- ============================================================
-- Supabase/PostgreSQL Schema Inspection Queries - combined
--
-- Use this version in the Supabase SQL Editor when you want
-- every inspection query to appear in a single result grid.
-- Each row contains: section_order, section, row_count, rows, error.
-- ============================================================

create or replace function pg_temp.run_schema_inspection(
  p_section_order integer,
  p_section text,
  p_sql text
)
returns table(
  section_order integer,
  section text,
  row_count bigint,
  rows jsonb,
  error text
)
language plpgsql
as $$
begin
  section_order := p_section_order;
  section := p_section;
  error := null;

  execute format('select count(*)::bigint, coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', p_sql)
    into row_count, rows;

  return next;
exception when others then
  section_order := p_section_order;
  section := p_section;
  row_count := 0;
  rows := '[]'::jsonb;
  error := sqlerrm;
  return next;
end;
$$;

with inspection_queries(section_order, section, sql) as (
  values (1, '1. Tabelas do schema public', $inspection_query$
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
order by table_name
$inspection_query$)
       , (2, '2. Colunas das tabelas', $inspection_query$
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.datetime_precision
from information_schema.columns c
where c.table_schema = 'public'
order by
  c.table_name,
  c.ordinal_position
$inspection_query$)
       , (3, '3. Comentários de tabelas e colunas (1)', $inspection_query$
select
  n.nspname as schema_name,
  c.relname as table_name,
  obj_description(c.oid) as table_comment
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname
$inspection_query$)
       , (3, '3. Comentários de tabelas e colunas (2)', $inspection_query$
select
  n.nspname as schema_name,
  c.relname as table_name,
  a.attname as column_name,
  col_description(c.oid, a.attnum) as column_comment
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
join pg_attribute a
  on a.attrelid = c.oid
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and a.attnum > 0
  and not a.attisdropped
order by
  c.relname,
  a.attnum
$inspection_query$)
       , (4, '4. Primary Keys', $inspection_query$
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'PRIMARY KEY'
order by
  tc.table_name,
  kcu.ordinal_position
$inspection_query$)
       , (5, '5. Foreign Keys e relacionamentos', $inspection_query$
select
  tc.table_schema,
  tc.table_name as source_table,
  kcu.column_name as source_column,
  ccu.table_name as target_table,
  ccu.column_name as target_column,
  tc.constraint_name,
  rc.update_rule,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
  and rc.constraint_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
order by
  source_table,
  source_column
$inspection_query$)
       , (6, '6. Unique constraints', $inspection_query$
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'UNIQUE'
group by
  tc.table_schema,
  tc.table_name,
  tc.constraint_name
order by
  tc.table_name,
  tc.constraint_name
$inspection_query$)
       , (7, '7. Check constraints', $inspection_query$
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on cc.constraint_name = tc.constraint_name
  and cc.constraint_schema = tc.constraint_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'CHECK'
order by
  tc.table_name,
  tc.constraint_name
$inspection_query$)
       , (8, '8. Todos os constraints', $inspection_query$
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
from information_schema.table_constraints tc
where tc.table_schema = 'public'
order by
  tc.table_name,
  tc.constraint_type,
  tc.constraint_name
$inspection_query$)
       , (9, '9. Índices', $inspection_query$
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
order by
  tablename,
  indexname
$inspection_query$)
       , (10, '10. Possíveis foreign keys sem índice dedicado', $inspection_query$
with foreign_keys as (
  select
    tc.table_schema,
    tc.table_name,
    kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
    and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.constraint_type = 'FOREIGN KEY'
),
indexed_columns as (
  select
    schemaname,
    tablename,
    indexname,
    indexdef
  from pg_indexes
  where schemaname = 'public'
)
select
  fk.table_schema,
  fk.table_name,
  fk.column_name,
  case
    when exists (
      select 1
      from indexed_columns i
      where i.tablename = fk.table_name
        and i.indexdef ilike '%' || fk.column_name || '%'
    )
    then 'Possui índice provável'
    else 'Possível índice ausente'
  end as index_status
from foreign_keys fk
order by
  fk.table_name,
  fk.column_name
$inspection_query$)
       , (11, '11. RLS ativa ou inativa por tabela', $inspection_query$
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by
  c.relname
$inspection_query$)
       , (12, '12. Policies de RLS', $inspection_query$
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
order by
  tablename,
  policyname
$inspection_query$)
       , (13, '13. Tabelas sem RLS ativa', $inspection_query$
select
  n.nspname as schema_name,
  c.relname as table_name
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity = false
order by
  c.relname
$inspection_query$)
       , (14, '14. Triggers', $inspection_query$
select
  event_object_schema as table_schema,
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
order by
  event_object_table,
  trigger_name
$inspection_query$)
       , (15, '15. Funções/RPCs do schema public', $inspection_query$
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language,
  case
    when p.prosecdef then 'SECURITY DEFINER'
    else 'SECURITY INVOKER'
  end as security_mode,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
join pg_language l
  on l.oid = p.prolang
where n.nspname = 'public'
order by
  p.proname
$inspection_query$)
       , (16, '16. Funções SECURITY DEFINER', $inspection_query$
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by
  p.proname
$inspection_query$)
       , (17, '17. Views', $inspection_query$
select
  table_schema,
  table_name,
  view_definition
from information_schema.views
where table_schema = 'public'
order by
  table_name
$inspection_query$)
       , (18, '18. Materialized views', $inspection_query$
select
  schemaname,
  matviewname,
  definition
from pg_matviews
where schemaname = 'public'
order by
  matviewname
$inspection_query$)
       , (19, '19. Enums customizados', $inspection_query$
select
  n.nspname as schema_name,
  t.typname as enum_name,
  e.enumlabel as enum_value,
  e.enumsortorder
from pg_type t
join pg_enum e
  on t.oid = e.enumtypid
join pg_namespace n
  on n.oid = t.typnamespace
where n.nspname = 'public'
order by
  enum_name,
  e.enumsortorder
$inspection_query$)
       , (20, '20. Extensões instaladas', $inspection_query$
select
  extname as extension_name,
  extversion as extension_version
from pg_extension
order by
  extname
$inspection_query$)
       , (21, '21. Storage buckets do Supabase', $inspection_query$
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
from storage.buckets
order by
  name
$inspection_query$)
       , (22, '22. Policies de objetos do Storage', $inspection_query$
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'storage'
order by
  tablename,
  policyname
$inspection_query$)
       , (23, '23. Estimativa de tamanho das tabelas', $inspection_query$
select
  schemaname,
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as indexes_size
from pg_catalog.pg_statio_user_tables
where schemaname = 'public'
order by
  pg_total_relation_size(relid) desc
$inspection_query$)
       , (24, '24. Estimativa de quantidade de registros', $inspection_query$
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_live_rows,
  n_dead_tup as estimated_dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by
  n_live_tup desc
$inspection_query$)
       , (25, '25. Colunas potencialmente sensíveis', $inspection_query$
select
  table_schema,
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    column_name ilike '%email%'
    or column_name ilike '%phone%'
    or column_name ilike '%telefone%'
    or column_name ilike '%cpf%'
    or column_name ilike '%cnpj%'
    or column_name ilike '%document%'
    or column_name ilike '%password%'
    or column_name ilike '%token%'
    or column_name ilike '%secret%'
    or column_name ilike '%key%'
    or column_name ilike '%address%'
    or column_name ilike '%endereco%'
    or column_name ilike '%birth%'
    or column_name ilike '%name%'
    or column_name ilike '%nome%'
    or column_name ilike '%gateway%'
    or column_name ilike '%customer%'
    or column_name ilike '%payment%'
  )
order by
  table_name,
  column_name
$inspection_query$)
       , (26, '26. Colunas JSON/JSONB', $inspection_query$
select
  table_schema,
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and data_type in ('json', 'jsonb')
order by
  table_name,
  column_name
$inspection_query$)
       , (27, '27. Colunas de status', $inspection_query$
select
  table_schema,
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    column_name = 'status'
    or column_name ilike '%status%'
    or column_name ilike '%state%'
  )
order by
  table_name,
  column_name
$inspection_query$)
       , (28, '28. Colunas de auditoria temporal', $inspection_query$
select
  table_schema,
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name in (
    'created_at',
    'updated_at',
    'deleted_at',
    'started_at',
    'ended_at',
    'expires_at',
    'paid_at',
    'cancelled_at',
    'canceled_at'
  )
order by
  table_name,
  column_name
$inspection_query$)
       , (29, '29. Tabelas sem created_at', $inspection_query$
select
  t.table_schema,
  t.table_name
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
  and not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = t.table_schema
      and c.table_name = t.table_name
      and c.column_name = 'created_at'
  )
order by
  t.table_name
$inspection_query$)
       , (30, '30. Tabelas sem updated_at', $inspection_query$
select
  t.table_schema,
  t.table_name
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
  and not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = t.table_schema
      and c.table_name = t.table_name
      and c.column_name = 'updated_at'
  )
order by
  t.table_name
$inspection_query$)
)
select r.section_order, r.section, r.row_count, r.rows, r.error
from inspection_queries i
cross join lateral pg_temp.run_schema_inspection(i.section_order, i.section, i.sql) r
order by r.section_order, r.section;
