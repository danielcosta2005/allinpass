-- Upsert de planos comerciais com base no frontend/src/lib/subscriptionPlans.js
-- Snapshot aplicado em 2026-05-08.
-- Mantem a migration idempotente via ON CONFLICT (code).

with plan_seed as (
  select *
  from (
    values
      (
        'free_trial'::text,
        'Free Trial'::text,
        'Teste todos os recursos do AllinPass por 7 dias.'::text,
        'monthly'::text,
        0::integer,
        7::integer,
        75::integer,
        250::integer,
        0::integer,
        0::integer,
        jsonb_build_array(
          'Acesso completo a todos os recursos',
          'Notificacoes automatizadas',
          'Notificacoes por geolocalizacao',
          'Dashboards para analise de desempenho',
          'Ate 75 instalacoes de passe',
          'Ate 250 notificacoes no periodo de trial',
          'Onboarding guiado para primeiro uso',
          'Sem necessidade de cartao de credito'
        )
      ),
      (
        'starter'::text,
        'Starter'::text,
        'Para quem esta comecando a fidelizar.'::text,
        'monthly'::text,
        19770::integer,
        0::integer,
        300::integer,
        1000::integer,
        8::integer,
        2::integer,
        jsonb_build_array(
          'Acesso a todas as funcionalidades AllinPass',
          'Ate 300 instalacoes de passe/mes',
          '1.000 notificacoes/mes',
          'Excedente: R$ 0,08 por instalacao',
          'Excedente: R$ 0,02 por notificacao enviada'
        )
      ),
      (
        'pro'::text,
        'Pro'::text,
        'O queridinho de quem quer crescer.'::text,
        'monthly'::text,
        29770::integer,
        0::integer,
        1500::integer,
        10000::integer,
        4::integer,
        1::integer,
        jsonb_build_array(
          'Acesso a todas as funcionalidades AllinPass',
          'Ate 1.500 instalacoes de passe/mes',
          '10.000 notificacoes/mes',
          'Excedente: R$ 0,04 por instalacao',
          'Excedente: R$ 0,01 por notificacao enviada'
        )
      ),
      (
        'premium'::text,
        'Premium'::text,
        'Para operacoes de alto volume.'::text,
        'monthly'::text,
        39770::integer,
        0::integer,
        8000::integer,
        50000::integer,
        3::integer,
        1::integer,
        jsonb_build_array(
          'Acesso a todas as funcionalidades AllinPass',
          'Ate 8.000 instalacoes de passe/mes',
          '50.000 notificacoes/mes',
          'Excedente: R$ 0,03 por instalacao',
          'Excedente: R$ 0,01 por notificacao enviada'
        )
      )
  ) as t(
    code,
    name,
    description,
    billing_interval,
    base_price_cents,
    trial_days,
    included_pass_installs,
    included_notification_sends,
    overage_pass_install_cents,
    overage_notification_sent_cents,
    features
  )
)
insert into public.billing_plans (
  code,
  name,
  description,
  billing_interval,
  base_price_cents,
  included_passes,
  overage_price_cents,
  trial_days,
  is_active,
  features,
  included_pass_installs,
  included_notification_sends,
  overage_pass_install_cents,
  overage_notification_sent_cents
)
select
  p.code,
  p.name,
  p.description,
  p.billing_interval,
  p.base_price_cents,
  p.included_pass_installs as included_passes,
  p.overage_pass_install_cents as overage_price_cents,
  p.trial_days,
  true as is_active,
  p.features,
  p.included_pass_installs,
  p.included_notification_sends,
  p.overage_pass_install_cents,
  p.overage_notification_sent_cents
from plan_seed p
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  billing_interval = excluded.billing_interval,
  base_price_cents = excluded.base_price_cents,
  included_passes = excluded.included_passes,
  overage_price_cents = excluded.overage_price_cents,
  trial_days = excluded.trial_days,
  is_active = excluded.is_active,
  features = excluded.features,
  included_pass_installs = excluded.included_pass_installs,
  included_notification_sends = excluded.included_notification_sends,
  overage_pass_install_cents = excluded.overage_pass_install_cents,
  overage_notification_sent_cents = excluded.overage_notification_sent_cents;

