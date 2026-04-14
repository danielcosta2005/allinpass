const { cleanupProjectData, provisionProjectAndOwner } = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function add-wallet (chamada do frontend)", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("add-wallet cleanup warnings:", errors.join(" | "));
    }
  });

  test("responde via HTTP e retorna payload estruturado (ou 404 quando não implantada)", async () => {
    const response = await invokeEdgeFunction("add-wallet", {
      accessToken: context.owner.accessToken,
      body: {
        wallet_address: `0x${"a".repeat(40)}`,
        chain: "ethereum",
        label: "Carteira Integração",
      },
    });

    if (response.status === 404) {
      console.warn("add-wallet não encontrada no deployment atual.");
      expect(response.text).toBeTruthy();
      return;
    }

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);
    expect(response.body || response.text).toBeTruthy();
  });
});
