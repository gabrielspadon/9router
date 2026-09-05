import https from "https";
import pkg from "../../../../package.json" with { type: "json" };
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { isUpdateDisabled } from "@/lib/appUpdater";

// The package the updater actually installs from, so a fork retargets one name.
const NPM_PACKAGE_NAME = UPDATER_CONFIG.npmPackageName;
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function getLatestVersionCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

export async function GET() {
  // latestVersion is the npm `latest` of the CLI package, so the local side of
  // the comparison has to be the CLI's version too. The launcher passes it
  // down; the bundled tokenproxy-app version is the fallback for a server started
  // some other way, and the two release independently (#1012).
  const currentVersion = process.env.TOKENPROXY_CLI_VERSION || pkg.version;
  const isTrayMode = process.env.TRAY_MODE === "1";
  // TP_BUILD_SHA is inlined at app build time (next.config.mjs); in dev/test
  // it resolves from the real process env. Null when neither has it.
  const buildSha = process.env.TP_BUILD_SHA || null;

  // Opted out: skip the registry lookup entirely, so a pinned install neither
  // phones home nor gets offered the version it just rolled back from (#1563).
  if (isUpdateDisabled()) {
    return Response.json({ currentVersion, latestVersion: null, hasUpdate: false, isTrayMode, buildSha });
  }

  const latestVersion = await getLatestVersionCached();
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate, isTrayMode, buildSha });
}
