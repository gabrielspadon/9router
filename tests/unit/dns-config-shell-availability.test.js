import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dnsConfigPath = fileURLToPath(new URL("../../src/mitm/dns/dnsConfig.js", import.meta.url));

describe("MITM DNS shell availability", () => {
  it("rejects cleanly when the no-sudo fallback has no sh shell", () => {
    const script = `
      const { execWithPassword } = require(${JSON.stringify(dnsConfigPath)});
      execWithPassword("true", "")
        .then(() => {
          console.error("unexpected success");
          process.exitCode = 1;
        })
        .catch((error) => process.stdout.write(error.message));
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/sh.*not available/i);
  });
});
