const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readAffiliatePayoutMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  return fs
    .readdirSync(migrationsDir)
    .filter((name) =>
      name.endsWith(".sql") &&
      (name.includes("affiliate_payout") || name.includes("commission_payment"))
    )
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("affiliate commission dashboard and payouts", () => {
  test("ships manual payout tracking schema with superadmin-only RLS", () => {
    const migrationSource = readAffiliatePayoutMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_payouts");
    expect(migrationSource).toContain("seller_id uuid not null references public.affiliate_sellers(id)");
    expect(migrationSource).toContain("competence_month date not null");
    expect(migrationSource).toContain("amount_cents integer not null default 0");
    expect(migrationSource).toContain("commission_count integer not null default 0");
    expect(migrationSource).toContain("currency text not null default 'BRL'");
    expect(migrationSource).toContain("status text not null default 'paid'");
    expect(migrationSource).toContain("payment_method text not null default 'pix_manual'");
    expect(migrationSource).toContain("paid_at timestamptz not null default now()");
    expect(migrationSource).toContain("paid_by uuid references auth.users(id)");
    expect(migrationSource).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(migrationSource).toContain("alter table public.affiliate_commissions");
    expect(migrationSource).toContain("add column if not exists payout_id uuid");
    expect(migrationSource).toContain("add column if not exists marked_paid_at timestamptz");
    expect(migrationSource).toContain("add column if not exists marked_paid_by uuid references auth.users(id)");
    expect(migrationSource).toContain("add column if not exists payment_note text");
    expect(migrationSource).toContain("affiliate_commissions_payout_id_idx");
    expect(migrationSource).toContain("affiliate_payouts_seller_competence_idx");
    expect(migrationSource).toContain("trg_affiliate_payouts_updated_at");
    expect(migrationSource).toContain("alter table public.affiliate_payouts enable row level security");
    expect(migrationSource).toContain("revoke all on table public.affiliate_payouts from anon");
    expect(migrationSource).toContain("grant select, insert, update, delete on table public.affiliate_payouts to authenticated");
    expect(migrationSource).toContain("grant all on table public.affiliate_payouts to service_role");
    expect(migrationSource).toContain("to authenticated");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("affiliate-admin exposes idempotent manual payout actions for superadmins", () => {
    const functionSource = readIfExists(
      path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"),
    );

    expect(functionSource).toContain("markCommissionPaid");
    expect(functionSource).toContain("markSellerCompetencePaid");
    expect(functionSource).toContain(".from(\"affiliate_payouts\")");
    expect(functionSource).toContain(".from(\"affiliate_commissions\")");
    expect(functionSource).toContain("marked_paid_at");
    expect(functionSource).toContain("marked_paid_by");
    expect(functionSource).toContain("paid_by: caller.user.id");
    expect(functionSource).toContain("payment_note");
    expect(functionSource).toContain("payout_id");
    expect(functionSource).toContain("commission.status === \"paid\"");
    expect(functionSource).toContain("action === \"markCommissionPaid\"");
    expect(functionSource).toContain("action === \"markSellerCompetencePaid\"");
    expect(functionSource).toContain("ensureSuperadmin");
    expect(functionSource).not.toContain("sendPix");
    expect(functionSource).not.toContain("createPix");
    expect(functionSource).not.toContain("auth.role()");
  });

  test("frontend helper maps payout fields and wraps mark-paid actions", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("markAffiliateCommissionPaid");
    expect(helperSource).toContain("markAffiliateSellerCompetencePaid");
    expect(helperSource).toContain("action: 'markCommissionPaid'");
    expect(helperSource).toContain("action: 'markSellerCompetencePaid'");
    expect(helperSource).toContain("markedPaidAt");
    expect(helperSource).toContain("markedPaidBy");
    expect(helperSource).toContain("payoutId");
    expect(helperSource).toContain("paymentNote");
    expect(helperSource).toContain("payout");
    expect(helperSource).not.toContain("commissionCents =");
    expect(helperSource).not.toContain("commissionRate");
    expect(helperSource).not.toContain("* 0.1");
    expect(helperSource).not.toContain("* 0.10");
  });

  test("AffiliatesTab renders commission, client and mark-paid controls", () => {
    const tabSource = readIfExists(
      path.join(repoRoot, "frontend/src/components/superadmin/AffiliatesTab.jsx"),
    );

    expect(tabSource).toContain("listAffiliateSellers");
    expect(tabSource).toContain("listAffiliateCommissions");
    expect(tabSource).toContain("listAffiliateCommissionClients");
    expect(tabSource).toContain("markAffiliateCommissionPaid");
    expect(tabSource).toContain("markAffiliateSellerCompetencePaid");
    expect(tabSource).toContain("commissionStatusFilter");
    expect(tabSource).toContain("commissionPage");
    expect(tabSource).toContain("clientPage");
    expect(tabSource).toContain("selectedCompetence");
    expect(tabSource).toContain("Comissoes");
    expect(tabSource).toContain("Clientes indicados");
    expect(tabSource).toContain("Competencia");
    expect(tabSource).toContain("Mes atual");
    expect(tabSource).toContain("Pendente");
    expect(tabSource).toContain("Pago");
    expect(tabSource).toContain("Marcar como paga");
    expect(tabSource).toContain("Marcar competencia");
    expect(tabSource).toContain("Sem pagamento confirmado");
    expect(tabSource).toContain("markedPaidAt");
    expect(tabSource).toContain("paymentNote");
    expect(tabSource).toContain("eligibleAmountCents");
    expect(tabSource).toContain("commissionCents");
    expect(tabSource).toContain("rateBps");
  });
});
