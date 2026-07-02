const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("ios toggle group animation", () => {
  test("uses the shared iOS-style animated toggle group in wallet preview and scanner mode", () => {
    const toggleGroupSource = readIfExists("frontend/src/components/ui/ios-toggle-group.jsx");
    const walletConfigSource = readIfExists("frontend/src/components/superadmin/WalletConfigTab.jsx");
    const scannerSource = readIfExists("frontend/src/components/restaurant/ScannerTab.jsx");

    expect(toggleGroupSource).toContain("function IosToggleGroup");
    expect(toggleGroupSource).toContain("role=\"radiogroup\"");
    expect(toggleGroupSource).toContain("role=\"radio\"");
    expect(toggleGroupSource).toContain("translateX(${activeIndex * 100}%)");
    expect(toggleGroupSource).toContain('transitionDuration: "420ms"');
    expect(toggleGroupSource).toContain('transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)"');
    expect(toggleGroupSource).toContain('transitionDuration: "260ms"');
    expect(toggleGroupSource).toContain("motion-reduce:transition-none");
    expect(toggleGroupSource).toContain("backdrop-blur");
    expect(toggleGroupSource).toContain("rounded-full bg-purple-600 shadow");
    expect(toggleGroupSource).not.toContain("rounded-full bg-slate-950 shadow");
    expect(toggleGroupSource).not.toContain("dark:bg-white");
    expect(toggleGroupSource).toContain("aria-checked={isActive}");

    expect(walletConfigSource).toContain("IosToggleGroup");
    expect(walletConfigSource).toContain("platformOptions");
    expect(walletConfigSource).toContain("onValueChange={setPlatform}");
    expect(walletConfigSource).not.toContain("platformButtonClass");

    expect(scannerSource).toContain("IosToggleGroup");
    expect(scannerSource).toContain("scannerModeOptions");
    expect(scannerSource).toContain("onValueChange={selectScannerMode}");
    expect(scannerSource).not.toContain("className={`rounded-full px-4 py-2");
  });
});
