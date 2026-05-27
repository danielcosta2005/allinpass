const { execFileSync } = require("node:child_process");
const path = require("node:path");

describe("Turnstile signup config", () => {
  test("uses Turnstile for free trial signup only when a site key is configured", () => {
    const projectRoot = path.resolve(__dirname, "../..");
    const script = `
      import {
        getTurnstileSiteKey,
        shouldUseSignupCaptcha,
      } from './src/lib/turnstileConfig.js';

      const siteKey = getTurnstileSiteKey({
        VITE_TURNSTILE_SITE_KEY: "  1x00000000000000000000AA  ",
      });

      console.log(JSON.stringify({
        siteKey,
        freeTrialWithKey: shouldUseSignupCaptcha({ paidPlan: false, siteKey }),
        paidPlanWithKey: shouldUseSignupCaptcha({ paidPlan: true, siteKey }),
        freeTrialWithoutKey: shouldUseSignupCaptcha({ paidPlan: false, siteKey: "" }),
      }));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: projectRoot,
        encoding: "utf8",
      }
    );
    const result = JSON.parse(output);

    expect(result.siteKey).toBe("1x00000000000000000000AA");
    expect(result.freeTrialWithKey).toBe(true);
    expect(result.paidPlanWithKey).toBe(false);
    expect(result.freeTrialWithoutKey).toBe(false);
  });
});
