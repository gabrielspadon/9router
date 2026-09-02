import { afterEach, beforeEach, expect, test, vi } from "vitest";

const reactHarness = vi.hoisted(() => ({ current: null }));

vi.mock("react", () => ({
  useState: (initial) => reactHarness.current.useState(initial),
  useEffect: (effect, deps) => reactHarness.current.useEffect(effect, deps),
  useMemo: (factory) => reactHarness.current.useMemo(factory),
  useRef: (initial) => reactHarness.current.useRef(initial),
}));

const baseUrlSelectModule = await import("../../src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect");
const BaseUrlSelect = baseUrlSelectModule.default;

const { __test__ } = baseUrlSelectModule;

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = { ...entries };
    this.writes = [];
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.entries, key) ? this.entries[key] : null;
  }

  setItem(key, value) {
    this.entries[key] = String(value);
    this.writes.push([key, String(value)]);
  }

  removeItem(key) {
    delete this.entries[key];
  }
}

function createRenderHarness(Component, initialProps) {
  const runtime = {
    props: { ...initialProps },
    states: [],
    refs: [],
    effectDeps: [],
    pendingEffects: [],
    hookIndex: 0,
    rendering: false,
    inEffects: false,
    pending: true,
    tree: null,
    renders: 0,
  };
  runtime.useState = (initial) => {
    const index = runtime.hookIndex++;
    if (!(index in runtime.states)) runtime.states[index] = typeof initial === "function" ? initial() : initial;
    return [runtime.states[index], (next) => {
      runtime.states[index] = typeof next === "function" ? next(runtime.states[index]) : next;
      runtime.pending = true;
      if (!runtime.rendering && !runtime.inEffects) runtime.flush();
    }];
  };
  runtime.useEffect = (effect, deps) => {
    const index = runtime.hookIndex++;
    const previous = runtime.effectDeps[index];
    const changed = deps === undefined || !previous || deps.length !== previous.length || deps.some((dep, i) => !Object.is(dep, previous[i]));
    if (changed) {
      runtime.effectDeps[index] = deps;
      runtime.pendingEffects.push(effect);
    }
  };
  runtime.useMemo = (factory) => {
    runtime.hookIndex++;
    return factory();
  };
  runtime.useRef = (initial) => {
    const index = runtime.hookIndex++;
    if (!(index in runtime.refs)) runtime.refs[index] = { current: initial };
    return runtime.refs[index];
  };
  runtime.flush = () => {
    if (runtime.rendering || runtime.inEffects) return;
    while (runtime.pending) {
      runtime.pending = false;
      runtime.pendingEffects = [];
      runtime.hookIndex = 0;
      runtime.rendering = true;
      runtime.tree = Component(runtime.props);
      runtime.rendering = false;
      runtime.inEffects = true;
      const effects = runtime.pendingEffects;
      runtime.pendingEffects = [];
      effects.forEach((effect) => effect());
      runtime.inEffects = false;
      runtime.renders += 1;
      if (runtime.renders > 50) throw new Error("render harness exceeded 50 renders");
    }
  };
  reactHarness.current = runtime;
  runtime.flush();
  return runtime;
}

function elementsOfType(node, type, result = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => elementsOfType(child, type, result));
    return result;
  }
  if (!node || typeof node !== "object") return result;
  if (node.type === type) result.push(node);
  const children = node.props?.children;
  if (Array.isArray(children)) children.forEach((child) => elementsOfType(child, type, result));
  else elementsOfType(children, type, result);
  return result;
}

function elementByAriaLabel(node, label) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = elementByAriaLabel(child, label);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.props?.["aria-label"] === label) return node;
  return elementByAriaLabel(node.props?.children, label);
}

function selectValue(runtime, value) {
  const select = elementsOfType(runtime.tree, "select")[0];
  select.props.onChange({ target: { value } });
}

function selectedValue(runtime) {
  return elementsOfType(runtime.tree, "select")[0].props.value;
}

function optionByValue(runtime, value) {
  return elementsOfType(runtime.tree, "option").find((option) => option.props.value === value);
}

function customInput(runtime) {
  return elementsOfType(runtime.tree, "input")[0];
}

beforeEach(() => {
  globalThis.window = { localStorage: new MemoryStorage(), prompt: vi.fn() };
});

afterEach(() => {
  reactHarness.current = null;
  delete globalThis.window;
});

const keys = {
  presets: "tokenproxy.cliToolUrlPresets.v1",
  lastCustom: "tokenproxy.cliToolLastCustomUrl.v1",
  legacy: "tokenproxy.cliToolEndpointPresets",
};

const valid = { name: "Main", baseUrl: " https://router.example:8443/api " };

test("rejects a legacy record carrying an API-key-shaped extra field", () => {
  const sentinel = "must-not-persist";
  const result = __test__.parsePresetList(JSON.stringify([
    { name: "Unsafe", baseUrl: "https://router.example/v1", apiKey: sentinel },
  ]));
  expect(result).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("normalizes only exact preset records and trims accepted fields", () => {
  expect(__test__.normalizePreset(valid)).toEqual({ name: "Main", baseUrl: "https://router.example:8443/api" });
  for (const record of [
    { name: "x", baseUrl: "https://router.example", apiKey: "secret" },
    { name: "x", baseUrl: "https://router.example", extra: true },
    { name: "x" },
    { name: 42, baseUrl: "https://router.example" },
    { name: "x", baseUrl: 42 },
    { name: "   ", baseUrl: "https://router.example" },
  ]) {
    expect(__test__.normalizePreset(record)).toBeNull();
  }
});

test("rejects a non-enumerable API-key-shaped own field", () => {
  const sentinel = "non-enumerable-secret";
  const record = { name: "Unsafe", baseUrl: "https://router.example" };
  Object.defineProperty(record, "apiKey", { value: sentinel, enumerable: false });
  const result = __test__.parsePresetList([record]);
  expect(result).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("rejects a symbol-keyed extra own field", () => {
  const sentinel = "symbol-secret";
  const extra = Symbol("apiKey");
  const record = { name: "Unsafe", baseUrl: "https://router.example" };
  record[extra] = sentinel;
  const result = __test__.parsePresetList([record]);
  expect(result).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("parses malformed storage as an empty safe list", () => {
  expect(__test__.parsePresetList("not-json")).toEqual([]);
  expect(__test__.parsePresetList(JSON.stringify({ name: "x" }))).toEqual([]);
  expect(__test__.parsePresetList(JSON.stringify([valid, { name: "bad", baseUrl: "/relative" }]))).toEqual([
    { name: "Main", baseUrl: "https://router.example:8443/api" },
  ]);
});

test("accepts only host-bearing HTTP and HTTPS URLs without credentials or selectors", () => {
  for (const url of [
    " https://router.example:9443/api/v1 ",
    "http://localhost:20128/path",
    "https://[::1]:8443/v1",
  ]) expect(__test__.isSafeBaseUrl(url)).toBe(true);
  for (const url of [
    "",
    "   ",
    "/v1",
    "router.example/v1",
    "https://",
    "ftp://router.example/v1",
    "https://user:pass@router.example/v1",
    "https://router.example/v1?token=secret",
    "https://router.example/v1#fragment",
  ]) expect(__test__.isSafeBaseUrl(url)).toBe(false);
});

test("migrates safe legacy records once and preserves legacy bytes", () => {
  const legacyBytes = JSON.stringify([
    { name: "Zed", baseUrl: " https://zed.example " },
    { name: "Unsafe", baseUrl: "https://unsafe.example", apiKey: "sentinel" },
  ]);
  const storage = new MemoryStorage({ [keys.legacy]: legacyBytes });
  expect(__test__.readPresetStorage(storage)).toEqual([{ name: "Zed", baseUrl: "https://zed.example" }]);
  expect(storage.getItem(keys.legacy)).toBe(legacyBytes);
  const migratedBytes = storage.getItem(keys.presets);
  expect(JSON.parse(migratedBytes)).toEqual([{ name: "Zed", baseUrl: "https://zed.example" }]);

  storage.entries[keys.legacy] = JSON.stringify([{ name: "Later", baseUrl: "https://later.example" }]);
  expect(__test__.readPresetStorage(storage)).toEqual([{ name: "Zed", baseUrl: "https://zed.example" }]);
  expect(storage.getItem(keys.presets)).toBe(migratedBytes);
});

test("writes an empty v1 list when legacy data has no safe records", () => {
  const legacyBytes = JSON.stringify([{ name: "Unsafe", baseUrl: "javascript:alert(1)" }]);
  const storage = new MemoryStorage({ [keys.legacy]: legacyBytes });
  expect(__test__.readPresetStorage(storage)).toEqual([]);
  expect(storage.getItem(keys.presets)).toBe("[]");
  expect(storage.getItem(keys.legacy)).toBe(legacyBytes);
});

test("v1 storage ignores invalid records and never serializes unknown fields", () => {
  const sentinel = "must-not-persist";
  const storage = new MemoryStorage({
    [keys.presets]: JSON.stringify([
      { name: "Safe", baseUrl: "https://safe.example", apiKey: sentinel },
      { name: "Good", baseUrl: "https://good.example" },
    ]),
  });
  expect(__test__.readPresetStorage(storage)).toEqual([{ name: "Good", baseUrl: "https://good.example" }]);
  expect(storage.getItem(keys.presets)).toBe(JSON.stringify([{ name: "Good", baseUrl: "https://good.example" }]));
  expect(storage.getItem(keys.presets)).not.toContain(sentinel);
});

test("leaves malformed existing v1 bytes untouched while failing soft", () => {
  const storage = new MemoryStorage({ [keys.presets]: "not-json" });
  expect(__test__.readPresetStorage(storage)).toEqual([]);
  expect(storage.getItem(keys.presets)).toBe("not-json");
});

test("removes an invalid persisted last custom URL and returns empty", () => {
  const storage = new MemoryStorage({ [keys.lastCustom]: "https://router.example/v1?token=secret" });
  expect(__test__.readLastCustomUrl(storage)).toBe("");
  expect(storage.getItem(keys.lastCustom)).toBeNull();
  storage.setItem(keys.lastCustom, " https://router.example/v1 ");
  expect(__test__.readLastCustomUrl(storage)).toBe("https://router.example/v1");
});

test("custom seed prefers current value, then safe cached value, then empty", () => {
  expect(__test__.getCustomSeed("  https://current.example  ", "https://cached.example")).toBe("https://current.example");
  expect(__test__.getCustomSeed("  unsafe-current ", "https://cached.example")).toBe("unsafe-current");
  expect(__test__.getCustomSeed("   ", " https://cached.example/v1 ")).toBe("https://cached.example/v1");
  expect(__test__.getCustomSeed("", "relative")).toBe("");
});

test("safe custom values update the cache while unsafe values do not overwrite it", () => {
  const storage = new MemoryStorage({ [keys.lastCustom]: "https://valid.example" });
  __test__.writeLastCustomUrl(storage, " https://new.example/path ");
  expect(storage.getItem(keys.lastCustom)).toBe("https://new.example/path");
  __test__.writeLastCustomUrl(storage, "https://bad.example?apiKey=secret");
  expect(storage.getItem(keys.lastCustom)).toBe("https://new.example/path");
});

test("formats base URLs with one terminal v1 and strips terminal slashes when disabled", () => {
  for (const url of ["https://router.example", "https://router.example/v1", "https://router.example/v1/"]) {
    expect(__test__.formatBaseUrl(url, true)).toBe("https://router.example/v1");
  }
  expect(__test__.formatBaseUrl("https://router.example", false)).toBe("https://router.example");
  expect(__test__.formatBaseUrl("https://router.example/v1", false)).toBe("https://router.example/v1");
  expect(__test__.formatBaseUrl("https://router.example/v1/", false)).toBe("https://router.example/v1");
  expect(__test__.formatBaseUrl("https://router.example/api/", true)).toBe("https://router.example/api/v1");
});

test("labels named presets without duplicating identical name and URL", () => {
  expect(__test__.getPresetLabel({ name: "Prod", baseUrl: "https://prod.example" })).toBe("Prod - https://prod.example");
  expect(__test__.getPresetLabel({ name: "https://prod.example", baseUrl: "https://prod.example" })).toBe("https://prod.example");
});

test("saving replaces exact names, sorts records, and persists only the safe shape", () => {
  const existing = [{ name: "Beta", baseUrl: "https://old.example" }];
  const next = __test__.savePreset(existing, { name: " Beta ", baseUrl: " https://new.example/v1/ " });
  expect(next).toEqual([{ name: "Beta", baseUrl: "https://new.example/v1/" }]);
  expect(Object.keys(next[0])).toEqual(["name", "baseUrl"]);
  expect(__test__.savePreset(next, { name: "Alpha", baseUrl: "https://alpha.example" })).toEqual([
    { name: "Alpha", baseUrl: "https://alpha.example" },
    { name: "Beta", baseUrl: "https://new.example/v1/" },
  ]);
});

test("deleting a named preset returns the remaining records and custom seed", () => {
  const presets = [
    { name: "Alpha", baseUrl: "https://alpha.example" },
    { name: "Beta", baseUrl: "https://beta.example" },
  ];
  expect(__test__.deletePreset(presets, "Alpha")).toEqual([{ name: "Beta", baseUrl: "https://beta.example" }]);
  expect(__test__.getCustomSeed("", "https://cached.example")).toBe("https://cached.example");
});

test("saved option values and callback values use display formatting while storage stays raw", () => {
  const saved = { name: "Prod", baseUrl: "https://prod.example" };
  const option = __test__.getSavedOption(saved, true);
  expect(option).toEqual({ value: "saved:Prod", label: "Prod - https://prod.example/v1", url: "https://prod.example/v1", saved: true });
  expect(__test__.getSelectedUrl(saved, false)).toBe("https://prod.example");
  expect(__test__.savePreset([], saved)).toEqual([saved]);
});

test("initial custom mode seeds from the current value, cached value, or empty callback", () => {
  const storage = new MemoryStorage({ [keys.lastCustom]: " https://cached.example/ " });
  window.localStorage = storage;
  const cachedChanges = [];
  const cachedRuntime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => cachedChanges.push(next),
    requiresExternalUrl: true,
  });
  expect(selectedValue(cachedRuntime)).toBe("__custom__");
  expect(customInput(cachedRuntime).props.value).toBe("https://cached.example/");
  expect(cachedChanges).toEqual(["https://cached.example/"]);

  window.localStorage = new MemoryStorage();
  const emptyChanges = [];
  const emptyRuntime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => emptyChanges.push(next),
    requiresExternalUrl: true,
  });
  expect(selectedValue(emptyRuntime)).toBe("__custom__");
  expect(customInput(emptyRuntime).props.value).toBe("");
  expect(emptyChanges).toEqual([""]);
});

test("external-only initialization keeps the caller URL when saved presets load", () => {
  const externalUrl = "https://external.example/v1";
  window.localStorage = new MemoryStorage({
    [keys.presets]: JSON.stringify([
      { name: "Alpha", baseUrl: "https://alpha.example" },
      { name: "Zeta", baseUrl: "https://zeta.example" },
    ]),
  });
  const changes = [];
  const runtime = createRenderHarness(BaseUrlSelect, {
    value: externalUrl,
    onChange: (next) => changes.push(next),
    requiresExternalUrl: true,
  });

  expect(selectedValue(runtime)).toBe("__custom__");
  expect(customInput(runtime).props.value).toBe(externalUrl);
  expect(changes).toEqual([externalUrl]);
});

test("saved selection uses one formatted URL for each visible option and callback", () => {
  const records = [
    { name: "Bare", baseUrl: "https://router.example" },
    { name: "V1", baseUrl: "https://router.example/v1" },
    { name: "V1Slash", baseUrl: "https://router.example/v1/" },
  ];
  const storage = new MemoryStorage({ [keys.presets]: JSON.stringify(records) });
  window.localStorage = storage;
  const changes = [];
  const runtime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => changes.push(next),
    requiresExternalUrl: true,
    withV1: true,
  });

  records.forEach((record) => {
    const formatted = __test__.formatBaseUrl(record.baseUrl, true);
    const option = optionByValue(runtime, `saved:${record.name}`);
    expect(option.props.children).toBe(`${record.name} - ${formatted}`);
    selectValue(runtime, `saved:${record.name}`);
    expect(selectedValue(runtime)).toBe(`saved:${record.name}`);
    expect(changes.at(-1)).toBe(formatted);
  });
});

test("saving bare, v1, and slash-terminated custom URLs persists raw input and emits formatted URL", () => {
  for (const [index, input] of [
    "https://router.example",
    "https://router.example/v1",
    "https://router.example/v1/",
  ].entries()) {
    const storage = new MemoryStorage();
    window.localStorage = storage;
    const changes = [];
    const name = `Saved${index}`;
    window.prompt = vi.fn(() => name);
    const runtime = createRenderHarness(BaseUrlSelect, {
      value: `  ${input}  `,
      onChange: (next) => changes.push(next),
      requiresExternalUrl: true,
      withV1: true,
    });
    selectValue(runtime, "__save__");
    expect(JSON.parse(storage.getItem(keys.presets))).toEqual([{ name, baseUrl: input }]);
    expect(selectedValue(runtime)).toBe(`saved:${name}`);
    expect(changes.at(-1)).toBe(__test__.formatBaseUrl(input, true));
  }
});

test("withV1 false strips terminal slashes for saved selection and save callback", () => {
  const records = [
    { name: "Bare", baseUrl: "https://router.example" },
    { name: "V1", baseUrl: "https://router.example/v1" },
    { name: "V1Slash", baseUrl: "https://router.example/v1/" },
  ];
  const storage = new MemoryStorage({ [keys.presets]: JSON.stringify(records) });
  window.localStorage = storage;
  const selectedChanges = [];
  const selectedRuntime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => selectedChanges.push(next),
    requiresExternalUrl: true,
    withV1: false,
  });
  records.forEach((record) => {
    selectValue(selectedRuntime, `saved:${record.name}`);
    expect(selectedChanges.at(-1)).toBe(__test__.formatBaseUrl(record.baseUrl, false));
  });

  records.forEach((record, index) => {
    const saveStorage = new MemoryStorage();
    window.localStorage = saveStorage;
    const saveChanges = [];
    const name = `NoV1${index}`;
    window.prompt = vi.fn(() => name);
    const runtime = createRenderHarness(BaseUrlSelect, {
      value: record.baseUrl,
      onChange: (next) => saveChanges.push(next),
      requiresExternalUrl: true,
      withV1: false,
    });
    selectValue(runtime, "__save__");
    expect(saveChanges.at(-1)).toBe(__test__.formatBaseUrl(record.baseUrl, false));
  });
});

test("invalid custom text remains visible without persistence or save prompt", () => {
  const storage = new MemoryStorage({
    [keys.presets]: JSON.stringify([{ name: "Existing", baseUrl: "https://existing.example" }]),
    [keys.lastCustom]: "https://cached.example",
  });
  window.localStorage = storage;
  const changes = [];
  const runtime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => changes.push(next),
    requiresExternalUrl: true,
  });
  selectValue(runtime, "__custom__");
  const writesBeforeInput = storage.writes.length;
  customInput(runtime).props.onChange({ target: { value: "https://bad.example?token=secret" } });
  expect(customInput(runtime).props.value).toBe("https://bad.example?token=secret");
  expect(storage.getItem(keys.lastCustom)).toBe("https://cached.example");
  expect(storage.writes).toHaveLength(writesBeforeInput);
  window.prompt = vi.fn();
  selectValue(runtime, "__save__");
  expect(window.prompt).not.toHaveBeenCalled();
  expect(storage.writes).toHaveLength(writesBeforeInput);
  expect(changes.at(-1)).toBe("https://bad.example?token=secret");
});

test("deleting a saved preset enters custom mode and uses current custom text before cache", () => {
  const storage = new MemoryStorage({
    [keys.presets]: JSON.stringify([{ name: "Saved", baseUrl: "https://saved.example" }]),
    [keys.lastCustom]: "https://cached.example",
  });
  window.localStorage = storage;
  const changes = [];
  const runtime = createRenderHarness(BaseUrlSelect, {
    value: "",
    onChange: (next) => changes.push(next),
    requiresExternalUrl: true,
  });
  selectValue(runtime, "saved:Saved");
  elementByAriaLabel(runtime.tree, "Delete saved endpoint").props.onClick();
  expect(JSON.parse(storage.getItem(keys.presets))).toEqual([]);
  expect(selectedValue(runtime)).toBe("__custom__");
  expect(customInput(runtime).props.value).toBe("https://cached.example");
  expect(changes.at(-1)).toBe("https://cached.example");
});
