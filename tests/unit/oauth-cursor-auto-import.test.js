// The route these cases cover was rewritten. src/app/api/oauth/cursor/auto-import/route.js
// now probes a LIST of candidate db paths per platform (getCandidatePaths), then
// walks three strategies in order: better-sqlite3 via require -> sqlite3 CLI ->
// a manual-paste fallback. The previous test asserted the shape it replaced —
// a single macOS path, a fuzzy LIKE key search, a "Please login to Cursor IDE
// first" message, and a 400 for unrecognised platforms. None of those exist any
// more, so every case below was re-pointed at the contract the route now has.
//
// WHY THE HAPPY PATH GOES THROUGH THE sqlite3 CLI AND NOT better-sqlite3.
// route.js:82 loads better-sqlite3 with require(), deliberately, so the route
// stays importable when the native bindings fail. vi.mock() only patches the
// ESM graph: inside this runner `import("better-sqlite3")` yields the mock while
// `require("better-sqlite3")` yields the real Database, so a vi.mock of that
// module never reached the route at all — which is why the old happy-path cases
// could not pass. The real bindings are also ABI-locked to whichever Node built
// them, so driving strategy 1 makes the result depend on the host. Strategy 2
// reaches the route through a real ESM import of child_process, so it is
// mockable and gives the same {found, accessToken, machineId} contract on any
// box. Strategy 1 failing is asserted as non-fatal instead.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// route.js captures execFileAsync = promisify(execFile) at module scope, so the
// mock has to honour the callback convention promisify wraps.
const sqliteRows = new Map();
let execFileCalls = [];
let sqliteCliFails = false;

vi.mock("child_process", () => ({
  execFile: (cmd, args, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    execFileCalls.push({ cmd, args });
    if (cmd !== "sqlite3") return done(new Error(`no such binary: ${cmd}`));
    if (sqliteCliFails) return done(new Error("sqlite3: unable to open database file"));
    const key = String(args[1]).match(/key='([^']*)'/)?.[1];
    return done(null, { stdout: sqliteRows.get(key) ?? "", stderr: "" });
  },
}));

const DARWIN_PATHS = [
  "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
  "/mock/home/Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
];
const LINUX_PATHS = [
  "/mock/home/.config/Cursor/User/globalStorage/state.vscdb",
  "/mock/home/.config/cursor/User/globalStorage/state.vscdb",
];

let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    sqliteRows.clear();
    execFileCalls = [];
    sqliteCliFails = false;
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── Candidate path probing ────────────────────────────────────────────

  it("reports every probed location when no macOS cursor db is accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    // The message must name each candidate, which is the whole point of listing them.
    for (const p of DARWIN_PATHS) expect(response.body.error).toContain(p);
    expect(fsPromises.access).toHaveBeenCalledTimes(DARWIN_PATHS.length);
  });

  // ── Token extraction (strategy 2, the sqlite3 CLI) ────────────────────

  it("extracts tokens using the first-priority keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    sqliteRows.set("cursorAuth/accessToken", "test-token\n");
    sqliteRows.set("storage.serviceMachineId", "test-machine-id\n");

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    sqliteRows.set("cursorAuth/accessToken", '"json-token"');
    sqliteRows.set("storage.serviceMachineId", '"json-machine-id"');

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // Replaces the old "fuzzy LIKE key matching" case. There is no fuzzy search in
  // the route now; the ordered key lists at route.js:10-15 are what took over the
  // job of finding a token stored under an alternate name.
  it("falls through to the lower-priority keys when the first ones are empty", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    sqliteRows.set("cursorAuth/accessToken", "");
    sqliteRows.set("cursorAuth/token", "fallback-token");
    sqliteRows.set("storage.serviceMachineId", "");
    sqliteRows.set("storage.machineId", "");
    sqliteRows.set("telemetry.machineId", "fallback-machine");

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
    // Every key in each list must actually be tried, in order, or the walk is a lie.
    const queried = execFileCalls.map((c) => String(c.args[1]).match(/key='([^']*)'/)?.[1]);
    expect(queried).toEqual([
      "cursorAuth/accessToken",
      "cursorAuth/token",
      "storage.serviceMachineId",
      "storage.machineId",
      "telemetry.machineId",
    ]);
  });

  // ── Manual fallback (strategy 3) ──────────────────────────────────────

  // Replaces the old "Please login to Cursor IDE first" case: the route no longer
  // emits that message, it hands the caller the db path to paste from instead.
  it("hands back the db path for manual entry when no strategy finds tokens", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBe(DARWIN_PATHS[0]);
    expect(response.body.error).toBeUndefined();
  });

  // Replaces the old "could not open it / SQLITE_CANTOPEN" case. A db that exists
  // but cannot be read is swallowed by both strategies; the invariant that still
  // matters is that it degrades to the manual fallback rather than a 500.
  it("degrades to the manual fallback, not a 500, when every strategy fails", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    sqliteCliFails = true;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBe(DARWIN_PATHS[0]);
  });

  // ── Non-macOS platforms ───────────────────────────────────────────────

  // The old case asserted linux used a single hardcoded path, a distinct error
  // message, and never called access(). getCandidatePaths gave linux a candidate
  // list and the shared message, so all three of those inverted.
  it("linux probes its own candidate list and shares the not-found message", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    for (const p of LINUX_PATHS) expect(response.body.error).toContain(p);
    expect(vi.mocked(fsPromises.access).mock.calls.map((c) => c[0])).toEqual(LINUX_PATHS);
  });

  // The old case asserted a 400 for an unrecognised platform. getCandidatePaths
  // has no allowlist any more: its final return is the catch-all branch, so a
  // platform it does not name gets the same treatment as linux.
  it("an unrecognised platform falls back to the catch-all candidate list", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(vi.mocked(fsPromises.access).mock.calls.map((c) => c[0])).toEqual(LINUX_PATHS);
  });
});
