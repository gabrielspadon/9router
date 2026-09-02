const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const APP_NAME = "tokenproxy";
const APP_LABEL = "com.tokenproxy.autostart";

/**
 * Resolve the absolute path to this package's cli.js.
 *
 * Order of preference:
 *   1. Explicit `cliPath` argument — cleanest, used when called from running
 *      cli.js with `__filename`.
 *   2. `process.argv[1]` if it's our cli.js — true when tokenproxy is currently
 *      running and the tray menu fires this code path.
 *   3. Compute relative to this file's own location. autostart.js lives at
 *      `<pkg>/src/cli/tray/autostart.js`, so cli.js is three levels up.
 *      This works for any global install layout (nvm, Volta, asdf, Homebrew,
 *      /usr/local, etc.) without depending on `npm bin -g` (removed in npm 9)
 *      or a hardcoded `/usr/local/...` path.
 *
 * Returns null if no candidate exists — callers should not write an autostart
 * entry pointing at a non-existent script.
 */
function getCliJsPath(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (process.argv[1]) {
    const resolved = path.resolve(process.argv[1]);
    if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  const computed = path.resolve(__dirname, "..", "..", "..", "cli.js");
  if (fs.existsSync(computed)) return computed;
  return null;
}

/**
 * Enable auto startup on OS boot
 * @param {string} cliPath - Optional path to cli.js (defaults to auto-detect)
 * @returns {boolean} success
 */
/**
 * Where an explicit "I do not want autostart" decision is recorded.
 *
 * isAutoStartEnabled() cannot answer this: false means "not registered", which
 * is the same whether the user never enabled it or turned it off on purpose.
 * Hide-to-Tray called enableAutoStart unconditionally, so every hide silently
 * undid that decision and the setting reappeared enabled (#3628).
 */
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function optOutFile() {
  return path.join(getDataDir(), "autostart-opt-out");
}

function autoStartDecisionFile() {
  return path.join(getDataDir(), "autostart-decided");
}

function isAutoStartOptedOut() {
  try {
    return fs.existsSync(optOutFile());
  } catch {
    return false; // unreadable state must not silently opt the user out either
  }
}

function setAutoStartOptOut(optedOut) {
  try {
    const file = optOutFile();
    if (optedOut) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, new Date().toISOString());
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return true;
  } catch {
    return false;
  }
}

function hasAutoStartDecision() {
  try {
    return isAutoStartOptedOut() || fs.existsSync(autoStartDecisionFile());
  } catch {
    return false;
  }
}

function rememberAutoStartDecision() {
  try {
    const file = autoStartDecisionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/**
 * Backward-compatible automatic autostart entry point.
 *
 * Callers using this helper are automatic paths, so they must also respect a
 * prior automatic setup or explicit preference.
 */
function enableAutoStartUnlessOptedOut(cliPath) {
  return ensureAutoStart(cliPath);
}

function enableAutoStart(cliPath) {
  // An explicit enable is the user changing their mind.
  setAutoStartOptOut(false);
  rememberAutoStartDecision();
  return registerAutoStart(cliPath);
}

/**
 * Enable autostart only before the user has made any autostart decision.
 *
 * Used by Hide-to-Tray.  A successful automatic setup records a decision so
 * manually removing the OS entry is not silently undone on the next hide.
 */
function ensureAutoStart(cliPath) {
  if (hasAutoStartDecision()) return false;
  const enabled = registerAutoStart(cliPath);
  if (enabled) rememberAutoStartDecision();
  return enabled;
}

function registerAutoStart(cliPath) {
  const platform = process.platform;

  if (!["darwin", "win32", "linux"].includes(platform)) return false;

  try {
    if (platform === "darwin") return enableMacOS(cliPath);
    if (platform === "win32") return enableWindows(cliPath);
    // XDG autostart (~/.config/autostart) only ever runs from a graphical
    // session manager, so it is silently inert on a headless server with no
    // DISPLAY at all -- #1431 is exactly that: Hide to Tray "succeeds" but
    // nothing runs after a reboot because nothing ever evaluates that
    // directory. Route headless Linux through a systemd --user unit instead.
    if (platform === "linux") return process.env.DISPLAY ? enableLinux(cliPath) : enableLinuxHeadless(cliPath);
  } catch (err) {
    // Silent fail — autostart is optional
  }
  return false;
}

/**
 * Disable auto startup
 * @returns {boolean} success
 */
function disableAutoStart() {
  const platform = process.platform;
  // Remember the decision so an automatic path cannot quietly undo it.
  setAutoStartOptOut(true);
  rememberAutoStartDecision();
  try {
    if (platform === "darwin") return disableMacOS();
    if (platform === "win32") return disableWindows();
    // Undo whichever Linux mechanism is active -- desktop-session autostart,
    // headless systemd unit, or (rarely) both if DISPLAY was toggled between
    // an enable and a later disable.
    if (platform === "linux") {
      disableLinux();
      return disableLinuxHeadless();
    }
  } catch (err) {}
  return false;
}

/**
 * Check if autostart is enabled.
 *
 * On macOS, both the plist file and the launchd registration must be present —
 * otherwise the tray menu would lie about the state (showing "✓ Enabled" even
 * when launchd has the agent in a failed state or hasn't loaded it).
 */
function isAutoStartEnabled() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      if (!fs.existsSync(plistPath)) return false;
      try {
        execSync(`launchctl list ${APP_LABEL}`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000
        });
        return true;
      } catch (e) {
        return false;
      }
    } else if (platform === "win32") {
      const startupPath = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
      return fs.existsSync(startupPath);
    } else if (platform === "linux") {
      const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
      if (fs.existsSync(desktopPath)) return true;
      // Same reasoning as the darwin branch above: a leftover unit file
      // is not proof the systemd --user manager actually has it linked.
      if (!fs.existsSync(systemdUnitPath())) return false;
      try {
        execSync(`systemctl --user is-enabled ${APP_NAME}.service`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000
        });
        return true;
      } catch (e) {
        return false;
      }
    }
  } catch (e) {}
  return false;
}

// ============ macOS ============

/**
 * Returns true when the current Node process IS the running instance that
 * launchd is managing under our agent label.
 *
 * `launchctl unload <plist>` (and `load`) for an Aqua user-domain agent sends
 * SIGTERM to the running process. When the running tokenproxy cli.js was itself
 * spawned by the autostart launchd agent (i.e. user enabled autostart at
 * some point, then rebooted, then clicked the tray icon's "Disable
 * Auto-start" menu item), an unload would kill the very process executing
 * the click handler — and the tray icon would disappear instead of the menu
 * label flipping back to "Enable Auto-start". This helper lets the enable
 * and disable paths sidestep that by skipping launchctl when we'd otherwise
 * be killing ourselves.
 */
function isAgentSelfMacOS() {
  try {
    const output = execSync(`launchctl list ${APP_LABEL}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    });
    const match = output.match(/"PID"\s*=\s*(\d+)/);
    return !!(match && parseInt(match[1], 10) === process.pid);
  } catch (e) {
    return false;
  }
}

function enableMacOS(cliPath) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);

  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  // Don't write a broken plist that references a non-existent script.
  if (!routerScript) return false;

  // Invoke node + cli.js directly with absolute paths — no shell wrapper.
  // The previous design ran `zsh -l -c "..."` so a login shell would source
  // nvm/.zshrc and set PATH; that's fragile (nvm.sh sourcing varies by user,
  // some setups don't put node on PATH from a non-interactive login shell).
  // EnvironmentVariables.PATH explicitly includes node's bin dir so child
  // processes spawned by cli.js (npm install at runtime, etc.) resolve.
  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${routerScript}</string>
        <string>--tray</string>
        <string>--skip-update</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/tokenproxy.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/tokenproxy.error.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);

  // If we're the running agent already, launchctl unload/load would send
  // ourselves SIGTERM. Skip it — the plist file is updated on disk and
  // launchd will pick it up at next login. isAutoStartEnabled() will still
  // return true because launchctl already has the agent loaded.
  if (isAgentSelfMacOS()) {
    return true;
  }

  // Register with launchd in the current session. Without this, the agent
  // only takes effect on the next user login and the user has no signal that
  // anything actually happened. `unload` first defends against re-enable
  // replacing an existing plist.
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {}
  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" });
  } catch (e) {
    // Even if load fails, the plist is on disk and will be picked up at next
    // login; report success based on the file write.
  }
  return true;
}

function disableMacOS() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);

  // Don't kill ourselves: when the current process is the running agent,
  // `launchctl unload` would send SIGTERM and the user clicking
  // "Disable Auto-start" from the tray menu would lose their tray icon
  // instead of just flipping the menu label. Skip the unload — removing the
  // plist file is enough to prevent the agent from starting on next login.
  if (!isAgentSelfMacOS()) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
    } catch (e) {}
  }

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return true;
}

// ============ Windows ============

function enableWindows(cliPath) {
  const startupDir = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);

  if (!fs.existsSync(startupDir)) return false;

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  // Run node + cli.js directly, hidden window. Avoids the fragile
  // `tokenproxy.cmd` lookup that depended on the npm prefix path.
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${routerScript}"" --tray --skip-update", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  return true;
}

function disableWindows() {
  const vbsPath = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
  }
  return true;
}

// ============ Linux ============

function enableLinux(cliPath) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);

  if (!fs.existsSync(autostartDir)) {
    try { fs.mkdirSync(autostartDir, { recursive: true }); }
    catch (e) { return false; }
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const desktopContent = `[Desktop Entry]
Type=Application
Name=TokenProxy
Comment=TokenProxy API Proxy
Exec=${nodePath} ${routerScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
  if (fs.existsSync(desktopPath)) {
    fs.unlinkSync(desktopPath);
  }
  return true;
}

function systemdUnitDir() {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

function systemdUnitPath() {
  return path.join(systemdUnitDir(), `${APP_NAME}.service`);
}

/**
 * Headless Linux autostart via a systemd --user unit (#1431).
 *
 * ~/.config/autostart/*.desktop is only ever evaluated by a graphical
 * session manager (GNOME, KDE, ...) starting up, so on a headless Ubuntu
 * server -- no desktop environment, no DISPLAY, ever -- that directory is
 * never read at all. Hide to Tray reported success there while nothing ran
 * after a reboot, because the file it wrote could not do anything. The
 * server itself does not need DISPLAY (only the tray icon does, and that
 * already degrades gracefully without one), so a systemd user unit gives
 * the same "starts on boot" outcome on a headless install.
 */
function enableLinuxHeadless(cliPath) {
  const unitDir = systemdUnitDir();
  try {
    fs.mkdirSync(unitDir, { recursive: true });
  } catch (e) {
    return false;
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const unitContent = `[Unit]
Description=TokenProxy API Proxy

[Service]
ExecStart=${nodePath} ${routerScript} --tray --skip-update
Restart=on-failure

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(systemdUnitPath(), unitContent);

  try {
    execSync("systemctl --user daemon-reload", { stdio: "ignore", timeout: 5000 });
  } catch (e) {
    // Best-effort -- a stale manager cache does not stop enable below.
  }

  try {
    execSync(`systemctl --user enable ${APP_NAME}.service`, { stdio: "ignore", timeout: 5000 });
  } catch (e) {
    // The running --user manager could not link the unit (no systemd user
    // session at all, or its search path does not see what was just
    // written). A unit file present but never linked into default.target
    // is exactly the original #1431 bug in a different disguise -- it sits
    // there but nothing runs it -- so this reports failure and does not
    // leave that orphaned file behind.
    try { fs.unlinkSync(systemdUnitPath()); } catch (e2) {}
    return false;
  }

  // Best-effort: without lingering, the user's systemd instance only exists
  // while they are logged in, so the unit would still not run after an
  // unattended reboot. Enabling lingering for your own account can require
  // polkit approval this process does not have, so its failure must not
  // fail the enable -- the unit is correctly registered and will still run
  // on the next login even without it.
  try {
    execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: "ignore", timeout: 5000 });
  } catch (e) {}

  return true;
}

function disableLinuxHeadless() {
  try {
    execSync(`systemctl --user disable ${APP_NAME}.service`, { stdio: "ignore", timeout: 5000 });
  } catch (e) {}
  const unitPath = systemdUnitPath();
  if (fs.existsSync(unitPath)) {
    fs.unlinkSync(unitPath);
  }
  return true;
}

module.exports = {
  enableAutoStart,
  enableAutoStartUnlessOptedOut,
  ensureAutoStart,
  isAutoStartOptedOut,
  disableAutoStart,
  isAutoStartEnabled
};
