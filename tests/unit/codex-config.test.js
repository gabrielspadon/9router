import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrateLegacyCodexHooks } from "@/shared/utils/codexConfig.js";

const routeSource = readFileSync(
  fileURLToPath(new URL("../../src/app/api/cli-tools/codex-settings/route.js", import.meta.url)),
  "utf8",
);

describe("migrateLegacyCodexHooks", () => {
  it("moves the legacy lifecycle flag into the documented features.hooks key", () => {
    const config = migrateLegacyCodexHooks({
      model: "gpt-5.6",
      features: { codex_hooks: true, apps: false },
    });

    expect(config).toEqual({
      model: "gpt-5.6",
      features: { hooks: true, apps: false },
    });
  });

  it("keeps an explicit current hook setting over the legacy value", () => {
    expect(migrateLegacyCodexHooks({
      features: { hooks: false, codex_hooks: true },
    })).toEqual({ features: { hooks: false } });
  });

  it("does not create a features table when no legacy setting exists", () => {
    expect(migrateLegacyCodexHooks({ model: "gpt-5.6" })).toEqual({ model: "gpt-5.6" });
  });
});

describe("Codex settings lifecycle migration", () => {
  it("runs the migration before both config.toml write paths", () => {
    expect(routeSource.match(/migrateLegacyCodexHooks\(parsed\)/g)).toHaveLength(2);
  });
});
