import { execFileSync, execSync } from "child_process";
import { realpathSync } from "fs";
import path from "path";
import { Agent } from "undici";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
// Other `[all]` extras (image, voice, otel, reports, evals, ...) are not
// useful for the tokenproxy proxy use case, so we don't track them here.
export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

// Marker packages that each extra pulls in. Detected from `pip list --format=json`
// so one call can answer both the installed version and active extras.
export const EXTRA_MARKERS = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;
// `python --version` is a fast local probe; a long timeout here only means a
// longer event-loop stall when the interpreter hangs (findPython310 is sync).
const HEADROOM_PY_PROBE_TIMEOUT_MS = 500;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      // Version-manager shim directories. A manager like mise puts its shims on
      // PATH from an interactive shell only (`eval "$(mise activate bash)"` in
      // ~/.bashrc), so a server started by a service manager sees neither the
      // shims nor the interpreter they point at, and headroom reported "no
      // Python >= 3.10" on a machine whose `python --version` says 3.12 (#2353).
      // The shims are real executables and resolve without the manager being
      // activated, which is what makes this work rather than just widen PATH.
      // Verified for mise; pyenv and asdf are listed because they have the same
      // shape, and a directory that does not exist simply yields no candidate.
      `${process.env.HOME || ""}/.local/share/mise/shims`,
      `${process.env.HOME || ""}/.pyenv/shims`,
      `${process.env.HOME || ""}/.asdf/shims`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""]
  .filter(Boolean)
  .join(path.delimiter);
const PYTHON_CANDIDATES = [
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3",
  "python",
];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

export const DEFAULT_HEADROOM_URL =
  process.env.HEADROOM_URL || "http://localhost:8787";

// External (user-managed) install support (#2917): a venv the EXTRA_BINS
// search list does not cover, notably one created to work around PEP 668
// "externally managed environment" on the system Python. An explicit
// override always wins over the PATH probe below, same as HEADROOM_URL above.
const HEADROOM_BIN_OVERRIDE = process.env.HEADROOM_BIN_PATH || null;
const HEADROOM_PYTHON_OVERRIDE = process.env.HEADROOM_PYTHON_PATH || null;

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary() {
  if (HEADROOM_BIN_OVERRIDE) return HEADROOM_BIN_OVERRIDE;
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    })
      .toString()
      .trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
// `python3`, `python3.13`, `python` can point at different envs on any OS. Prefer
// the interpreter that can also see the installed `headroom-ai` package so the
// dashboard probes and install action operate on the same interpreter as the CLI.
// Falls back to the first version-eligible candidate when headroom-ai is not yet
// installed anywhere (needed for the initial install).
// Interpreters to probe, most specific first: the python next to the headroom
// binary (guaranteed to have headroom-ai), then full paths from EXTRA_BINS, then
// bare names resolved via PATH.
function pythonCandidates() {
  const list = [];
  // Explicit override goes first but still runs through the same version +
  // `pip show headroom-ai` checks below, rather than being trusted blindly.
  if (HEADROOM_PYTHON_OVERRIDE) list.push(HEADROOM_PYTHON_OVERRIDE);
  const bin = findHeadroomBinary();
  if (bin) {
    const names = IS_WIN
      ? ["python.exe", "python3.exe"]
      : ["python3", "python3.13", "python"];
    // pipx and a venv both put a SYMLINK on PATH pointing into their own
    // environment, so dirname of what `which` printed is ~/.local/bin, whose
    // python3 is the system one and has no headroom-ai. Resolving the link
    // first lands in the environment's own bin, which is the interpreter that
    // can actually see the package (#3566). The literal directory stays as a
    // second candidate for the plain non-symlinked install.
    const dirs = [];
    try {
      const realDir = path.dirname(realpathSync(bin));
      dirs.push(realDir);
    } catch {
      // A broken or unreadable link is not fatal: fall through to the literal.
    }
    const literalDir = path.dirname(bin);
    if (!dirs.includes(literalDir)) dirs.push(literalDir);
    for (const dir of dirs) {
      for (const n of names) list.push(path.join(dir, n));
    }
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES)
      list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function parseHeadroomTimeoutMs() {
  const raw = Number(process.env.HEADROOM_TIMEOUT_MS);
  return Number.isFinite(raw) &&
    Number.isInteger(raw) &&
    raw > 0 &&
    raw < 600000
    ? raw
    : 30000;
}

export function findPython310() {
  let fallback = null;
  for (const candidate of pythonCandidates()) {
    try {
      // execFileSync (not execSync with an interpolated path): candidate may
      // contain spaces ("C:\Program Files\...") and must never be shell-parsed.
      const ver = execFileSync(candidate, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: HEADROOM_PY_PROBE_TIMEOUT_MS,
        env: { ...process.env, PATH: EXTENDED_PATH },
      })
        .toString()
        .trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (
        !(
          major > MIN_VERSION[0] ||
          (major === MIN_VERSION[0] && minor >= MIN_VERSION[1])
        )
      )
        continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
        return candidate;
      } catch {
        // Keep scanning until an interpreter that sees headroom-ai is found.
      }
    } catch {
      // candidate not present, try next
    }
  }
  return fallback;
}

// Windows commonly resolves the bare "localhost" hostname to the IPv6
// loopback before the IPv4 one, while a locally started headroom proxy binds
// only 127.0.0.1 — the health probe then reports "not running" against a
// proxy that is actually up (#2476, same DNS-order mismatch as the compress
// call in rtk/headroom.js). Force IPv4 only for the literal "localhost" host.
const IPV4_LOOPBACK_DISPATCHER = new Agent({ connect: { family: 4 } });
function dispatcherForUrl(url) {
  try {
    return new URL(url).hostname === "localhost" ? IPV4_LOOPBACK_DISPATCHER : undefined;
  } catch {
    return undefined;
  }
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS),
      dispatcher: dispatcherForUrl(url),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  const extrasStatus = installed
    ? getInstalledHeadroomExtras(python)
    : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}

// Parse installed headroom-ai version + which compression extras are
// actually installed (detected via marker package presence). One `pip list`
// call is enough to answer both questions.
//
// Returns: { installed: bool, version: string|null, extras: { code, ml } }
export function getInstalledHeadroomExtras(python) {
  const py = python || findPython310();
  if (!py)
    return {
      installed: false,
      version: null,
      extras: { code: false, ml: false },
    };
  try {
    const out = execFileSync(
      py,
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: HEADROOM_PIP_TIMEOUT_MS,
        env: { ...process.env, PATH: EXTENDED_PATH },
      },
    ).toString();
    const packages = JSON.parse(out);
    const names = new Set(
      packages.map((p) => String(p.name || "").toLowerCase()),
    );
    const installed = names.has("headroom-ai");
    if (!installed)
      return {
        installed: false,
        version: null,
        extras: { code: false, ml: false },
      };
    const version =
      packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version ||
      null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    return {
      installed: false,
      version: null,
      extras: { code: false, ml: false },
    };
  }
}
