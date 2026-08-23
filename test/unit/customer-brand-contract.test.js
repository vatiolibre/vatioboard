import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("customer brand and compatibility contracts", () => {
  it("presents one VatioLibre driving-tools identity", () => {
    const index = read("index.html");
    const manifest = JSON.parse(read("public/site.webmanifest"));

    expect(index).toContain("<title>VatioLibre Driving Tools</title>");
    expect(index).toContain('<meta property="og:site_name" content="VatioLibre" />');
    expect(index).not.toContain('content="VatioBoard"');
    expect(manifest.name).toBe("VatioLibre Driving Tools");
    expect(manifest.short_name).toBe("VL Driving Tools");
  });

  it("uses the official VatioLibre wordmark in both themes", () => {
    const lightLogo = read("public/img/vb_logo_light.svg");
    const darkLogo = read("public/img/vb_logo_dark.svg");

    expect(lightLogo).toContain('viewBox="0 0 825.6 109.09"');
    expect(darkLogo).toContain('viewBox="0 0 825.6 109.09"');
    expect(lightLogo).not.toContain('viewBox="0 0 756.89 107.09"');
    expect(darkLogo).not.toContain('viewBox="0 0 756.89 107.09"');
  });

  it("preserves local data, event, origin, and API compatibility names", () => {
    expect(read("index.html")).toContain('localStorage.getItem("vatio_board_lang")');
    expect(read("src/app/welcome-consent.ts")).toContain(
      '"vatioboard.welcome_consent.v1"',
    );
    expect(read("src/shared/cloud-sync.ts")).toContain(
      '"vatioboard-cloud-sync"',
    );
    expect(read("src/shared/cloud-sync.ts")).toContain(
      '"vatioboard:cloud-sync-status"',
    );
    expect(read("src/shared/cloud-library.ts")).toContain(
      '"vatioboard-cloud-library"',
    );
    expect(read("src/shared/backend-auth.ts")).toContain(
      '"https://vatioboard.com"',
    );
    expect(read("src/shared/environment.ts")).toContain(
      '"https://api.vatioboard.com"',
    );
    expect(read("public/CNAME").trim()).toBe("vatioboard.com");
  });
});
