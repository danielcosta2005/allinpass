const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function geocode-search", () => {
  test("valida payload obrigatório (address)", async () => {
    const response = await invokeEdgeFunction("geocode-search", {
      body: { address: "", limit: 3 },
    });

    expect(response.status).toBe(400);
    expect(response.body?.ok).toBe(false);
    expect(response.body?.errorCode).toBe("INVALID_REQUEST");
  });

  test("responde com resultados ou erro de configuração do provedor", async () => {
    const response = await invokeEdgeFunction("geocode-search", {
      body: { address: "Avenida Paulista, 1000, São Paulo", limit: 2 },
    });

    if (response.status === 200) {
      expect(response.body?.ok).toBe(true);
      expect(Array.isArray(response.body?.results)).toBe(true);
      return;
    }

    expect([500, 502, 504]).toContain(response.status);
    expect(response.body?.ok).toBe(false);
    expect(response.body?.error).toBeTruthy();
  });
});
