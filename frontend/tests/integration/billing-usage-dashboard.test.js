const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("billing usage dashboard", () => {
  test("loads cycle summaries, invoices, and collection batches for customer billing", () => {
    const billingSource = readIfExists("frontend/src/lib/billingUsageDashboard.js");
    const hookSource = readIfExists("frontend/src/hooks/useBillingUsageDashboard.js");

    expect(billingSource).toContain("export async function getBillingUsageDashboard");
    expect(billingSource).toContain(".from('billing_cycle_usage_summaries')");
    expect(billingSource).toContain(".from('billing_invoices')");
    expect(billingSource).toContain(".from('billing_invoice_collection_batches')");
    expect(billingSource).toContain("updated_payment_cents");
    expect(billingSource).toContain("totalInvoiceCents");
    expect(billingSource).toContain("basePriceCents");
    expect(billingSource).toContain("overageCents");

    expect(hookSource).toContain("useBillingUsageDashboard");
    expect(hookSource).toContain("getBillingUsageDashboard");
    expect(hookSource).toContain("if (!open || !projectId)");
  });

  test("renders invoice total and green/yellow stacked usage bars", () => {
    const dialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingDashboardDialog.jsx");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(dialogSource).toContain("function BillingDashboardDialog");
    expect(dialogSource).toContain("Fatura atual");
    expect(dialogSource).toContain("Fatura paga");
    expect(dialogSource).toContain("Fatura pendente");
    expect(dialogSource).toContain("Fatura em atraso");
    expect(dialogSource).toContain("Fatura sem excedente");
    expect(dialogSource).toContain("Assinatura");
    expect(dialogSource).toContain("Excedente");
    expect(dialogSource).toContain("Total da fatura");
    expect(dialogSource).toContain("Ver fatura atual");
    expect(dialogSource).toContain("from-background");
    expect(dialogSource).toContain("dark:from-card");
    expect(dialogSource).toContain("dark:to-background");
    expect(dialogSource).toContain("dark:bg-amber-500/10");
    expect(dialogSource).toContain("dark:bg-rose-500/10");
    expect(dialogSource).not.toContain("from-white");
    expect(dialogSource).toContain("ResponsiveContainer");
    expect(dialogSource).toContain("BarChart");
    expect(dialogSource).toContain("stackId=\"usage\"");
    expect(dialogSource).toContain("fill=\"#16a34a\"");
    expect(dialogSource).toContain("fill=\"#f59e0b\"");
    expect(dialogSource).toContain("margin={{ top: 8, right: 72, left: 0, bottom: 8 }}");
    expect(dialogSource).toContain("<YAxis type=\"category\" dataKey=\"name\" hide width={0} />");
    expect(dialogSource).toContain("includedUsagePercent");
    expect(dialogSource).toContain("overageUsagePercent");
    expect(dialogSource).toContain("formatPercentAxis");
    expect(dialogSource).toContain("const PERCENT_AXIS_TICKS = [25, 50, 75, 100]");
    expect(dialogSource).toContain("<XAxis type=\"number\" allowDecimals={false} domain={[0, chartMax]} ticks={PERCENT_AXIS_TICKS} tickFormatter={formatPercentAxis} />");
    expect(dialogSource).toContain("<ReferenceLine x={100}");
    expect(dialogSource).toContain("dataKey=\"includedUsagePercent\"");
    expect(dialogSource).toContain("dataKey=\"overageUsagePercent\"");
    expect(dialogSource).toContain("<LabelList dataKey=\"includedUsage\" position=\"insideRight\" formatter={formatInteger} fill=\"#ffffff\" />");
    expect(dialogSource).toContain("<LabelList dataKey=\"overageUsage\" position=\"right\" formatter={(value) => Number(value || 0) > 0 ? formatInteger(value) : ''} />");
    expect(dialogSource).not.toContain("<LabelList dataKey=\"includedUsagePercent\" position=\"insideRight\" formatter={formatPercentAxis}");
    expect(dialogSource).not.toContain("<LabelList dataKey=\"overageUsagePercent\" position=\"right\" formatter={(value) => Number(value || 0) > 0 ? formatPercentAxis(value) : ''}");
    expect(dialogSource).toContain("+{formatCurrencyFromCents(row.overageCents)} de excedente");
    expect(dialogSource).not.toContain("+{formatInteger(row.overageUsage)} excedente");

    expect(dashboardSource).toContain("showBillingOption");
    expect(dashboardSource).toContain("onOpenBilling");
    expect(dashboardSource).toContain("BillingDashboardDialog");
    expect(dashboardSource).toContain("billingDashboardOpen");
  });
});
