import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Mocked cookie store. `requested` records every cookie name the resolver asks for,
// so the test proves it reads LOCALE_COOKIE rather than guessing a name.
const jar = vi.hoisted(() => ({ value: undefined, requested: [] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name) {
      jar.requested.push(name);
      return jar.value === undefined ? undefined : { name, value: jar.value };
    },
  }),
}));

const { getServerLocale } = await import("@/i18n/server.js");
const { getLocaleDirection, RTL_LOCALES, LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE } =
  await import("@/i18n/config.js");
const { THEME_CONFIG } = await import("@/shared/constants/config.js");

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const layoutSource = readFileSync(resolve(repoRoot, "src/app/layout.js"), "utf8");

function setCookie(value) {
  jar.value = value;
  jar.requested = [];
}

describe("root <html lang> follows the locale cookie", () => {
  it("serves the cookie's locale", async () => {
    setCookie("fa");
    await expect(getServerLocale()).resolves.toBe("fa");
    expect(jar.requested).toContain(LOCALE_COOKIE);
  });

  it("falls back to the default when the cookie is absent", async () => {
    setCookie(undefined);
    await expect(getServerLocale()).resolves.toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default for an unsupported value", async () => {
    setCookie("kl");
    await expect(getServerLocale()).resolves.toBe(DEFAULT_LOCALE);
  });

  it("normalizes bare zh to zh-CN", async () => {
    setCookie("zh");
    await expect(getServerLocale()).resolves.toBe("zh-CN");
  });

  it("layout renders lang from the resolver, not the literal en", () => {
    expect(layoutSource).not.toMatch(/lang="en"/);
    expect(layoutSource).toMatch(/<html[^>]*lang=\{/);
  });
});

describe("root <html dir> is direction-correct", () => {
  it("declares exactly the four RTL locales in one map", () => {
    expect([...RTL_LOCALES].sort()).toEqual(["ar", "fa", "he", "ur"]);
  });

  for (const locale of ["ar", "he", "fa", "ur"]) {
    it(`is rtl for ${locale}`, () => {
      expect(getLocaleDirection(locale)).toBe("rtl");
    });
  }

  it("is ltr for every other shipped locale", () => {
    const ltr = LOCALES.filter((l) => !["ar", "he", "fa", "ur"].includes(l));
    expect(ltr.length).toBeGreaterThan(20);
    for (const locale of ltr) {
      expect(getLocaleDirection(locale), locale).toBe("ltr");
    }
  });

  it("is ltr for an unknown or missing locale", () => {
    expect(getLocaleDirection(undefined)).toBe("ltr");
    expect(getLocaleDirection("kl")).toBe("ltr");
  });

  it("layout renders dir from the direction map", () => {
    expect(layoutSource).toMatch(/<html[^>]*dir=\{/);
  });
});

describe("pre-paint theme script", () => {
  const match = layoutSource.match(/const THEME_PRE_PAINT_SCRIPT = `([\s\S]*?)`;/);

  it("exists in the layout as a blocking inline script", () => {
    expect(match).not.toBeNull();
    expect(layoutSource).toMatch(/__html: THEME_PRE_PAINT_SCRIPT/);
    // Blocking: no async/defer/type=module on the injected script tag.
    expect(layoutSource).not.toMatch(/THEME_PRE_PAINT_SCRIPT[\s\S]{0,120}(defer|async)/);
  });

  it("reads the same storage key the zustand store writes", () => {
    // Derived from THEME_CONFIG.storageKey, not a copy of its current value.
    expect(match[1]).toContain("${THEME_CONFIG.storageKey}");
  });

  function run({ stored, prefersDark = false }) {
    // Resolve the template literal the way the server would, from the real config.
    const script = Object.entries(THEME_CONFIG).reduce(
      (acc, [key, value]) => acc.replaceAll(`\${THEME_CONFIG.${key}}`, value),
      match[1]
    );
    expect(script).not.toContain("${");
    const classes = new Set();
    const sandbox = {
      localStorage: {
        getItem: (key) => (key === THEME_CONFIG.storageKey ? stored : null),
      },
      document: {
        documentElement: {
          classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
        },
      },
      matchMedia: () => ({ matches: prefersDark }),
    };
    sandbox.window = sandbox;
    runInNewContext(script, sandbox);
    return classes;
  }

  // Exactly what zustand's persist middleware serializes.
  const persisted = (theme) => JSON.stringify({ state: { theme }, version: 0 });

  it("adds .dark for a persisted dark theme", () => {
    expect(run({ stored: persisted("dark") }).has("dark")).toBe(true);
  });

  it("leaves .dark off for a persisted light theme", () => {
    expect(run({ stored: persisted("light") }).has("dark")).toBe(false);
  });

  it("follows the OS for the persisted system theme", () => {
    expect(run({ stored: persisted("system"), prefersDark: true }).has("dark")).toBe(true);
    expect(run({ stored: persisted("system"), prefersDark: false }).has("dark")).toBe(false);
  });

  it("uses the store's default theme when nothing is persisted", () => {
    // THEME_CONFIG.defaultTheme is "system", so an unvisited dark-OS user gets .dark.
    expect(run({ stored: null, prefersDark: true }).has("dark")).toBe(
      THEME_CONFIG.defaultTheme === "dark" || THEME_CONFIG.defaultTheme === "system"
    );
  });

  it("fails open on corrupt storage", () => {
    expect(() => run({ stored: "{not json" })).not.toThrow();
    expect(run({ stored: "{not json" }).has("dark")).toBe(false);
  });
});
