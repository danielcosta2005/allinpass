const fs = require("fs");
const path = require("path");

describe("Restaurant automation trigger options", () => {
  test("nao oferece automacao por quantidade de pontos na carteira", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/components/restaurant/AutomationsTab.jsx"),
      "utf8",
    );

    expect(source).not.toContain('id: "points_wallet"');
    expect(source).not.toContain("Quantidade de pontos na carteira");
  });
});
