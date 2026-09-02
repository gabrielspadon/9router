// @vitest-environment jsdom
// Issue #2745: the runtime translator walked text nodes only, so every string
// living in an attribute stayed English in all 34 locales. aria-label and title
// are the ones that matter most — an icon-only control has no text node at all,
// so a screen reader in Turkish read the English label out. The same pass also
// dropped the whitespace that separated an inline text node from its siblings,
// because translate() looks the string up trimmed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const TR = {
  "Save": "Kaydet",
  "Search providers": "Sağlayıcı ara",
  "Delete account": "Hesabı sil",
  "Provider logo": "Sağlayıcı logosu",
  "requests": "istek",
};

async function loadRuntime(locale = "tr") {
  vi.resetModules();
  document.cookie = `locale=${locale}`;
  global.fetch = vi.fn(async () => ({ json: async () => TR }));
  const mod = await import("@/i18n/runtime.js");
  return mod;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.cookie = "locale=en";
});

describe("attributes are translated, not just text nodes (#2745)", () => {
  it("translates aria-label on an icon-only control", async () => {
    document.body.innerHTML = `<button aria-label="Delete account"><svg /></button>`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.querySelector("button").getAttribute("aria-label")).toBe("Hesabı sil");
  });

  it("translates placeholder, title and alt", async () => {
    document.body.innerHTML = `
      <input placeholder="Search providers" />
      <span title="Save">x</span>
      <img alt="Provider logo" />`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.querySelector("input").getAttribute("placeholder")).toBe("Sağlayıcı ara");
    expect(document.querySelector("span").getAttribute("title")).toBe("Kaydet");
    expect(document.querySelector("img").getAttribute("alt")).toBe("Sağlayıcı logosu");
  });

  it("honours data-i18n-skip on the element and on an ancestor", async () => {
    document.body.innerHTML = `
      <input id="own" data-i18n-skip placeholder="Search providers" />
      <div data-i18n-skip><input id="under" placeholder="Search providers" /></div>`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.getElementById("own").getAttribute("placeholder")).toBe("Search providers");
    expect(document.getElementById("under").getAttribute("placeholder")).toBe("Search providers");
  });

  it("leaves an untranslated attribute exactly as authored", async () => {
    document.body.innerHTML = `<input placeholder="Not in the map" />`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.querySelector("input").getAttribute("placeholder")).toBe("Not in the map");
  });

  it("does not translate a translation when the locale changes twice", async () => {
    document.body.innerHTML = `<button aria-label="Delete account"></button>`;
    const { initRuntimeI18n, reloadTranslations } = await loadRuntime();
    await initRuntimeI18n();
    document.cookie = "locale=en";
    await reloadTranslations();
    expect(document.querySelector("button").getAttribute("aria-label")).toBe("Delete account");
  });

  it("translates a node added after init", async () => {
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Delete account");
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getAttribute("aria-label")).toBe("Hesabı sil");
  });
});

describe("inline text keeps the whitespace around it (#2745)", () => {
  it("preserves leading and trailing spaces of a text node", async () => {
    document.body.innerHTML = `<p><b>12</b> requests </p>`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.querySelector("p").textContent).toBe("12 istek ");
  });

  it("still translates a node with no padding", async () => {
    document.body.innerHTML = `<span>Save</span>`;
    const { initRuntimeI18n } = await loadRuntime();
    await initRuntimeI18n();
    expect(document.querySelector("span").textContent).toBe("Kaydet");
  });
});
