const { execFile, execSync } = require("child_process");

const IS_WIN = process.platform === "win32";

/**
 * Detect if current Windows process has admin rights (no UAC popup needed).
 * Uses `fltmc`, which only succeeds when elevated. `net session` was the older
 * probe and was replaced because it fails on hosts where the Server service is
 * stopped, reporting a normal account as unelevated.
 */
function isAdmin() {
  if (IS_WIN) {
    try {
      execSync("fltmc", { windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Quote a string safely for PowerShell single-quoted literal.
 */
function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runEncodedPowerShell(encoded) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      }
    );
  });
}

/**
 * Run PowerShell script — escalated via UAC popup if not already admin.
 * Returns Promise resolving on exit code 0, rejecting otherwise.
 *
 * IMPORTANT: each call triggers ONE UAC popup. Batch multiple admin tasks
 * into a single script string to minimize popups.
 */
function runElevatedPowerShell(script) {
  if (!IS_WIN) return Promise.reject(new Error("Windows-only"));

  const encoded = Buffer.from(script, "utf16le").toString("base64");

  // If already admin, run directly — zero popup
  if (isAdmin()) {
    return runEncodedPowerShell(encoded);
  }

  // Not admin — wrap with Start-Process -Verb RunAs (UAC popup)
  const wrapper = `
    $proc = Start-Process powershell -ArgumentList @(
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-WindowStyle','Hidden','-EncodedCommand','${encoded}'
    ) -Verb RunAs -Wait -PassThru -WindowStyle Hidden;
    if ($proc.ExitCode -ne 0) { throw "Elevated command exited with code $($proc.ExitCode)" }
  `;

  const wrapperEncoded = Buffer.from(wrapper, "utf16le").toString("base64");
  return runEncodedPowerShell(wrapperEncoded).catch((error) => {
    const msg = error.message;
    if (msg.includes("canceled by the user") || msg.includes("operation was canceled")) {
      throw new Error("User canceled UAC prompt");
    }
    throw error;
  });
}

module.exports = { isAdmin, runElevatedPowerShell, quotePs };
