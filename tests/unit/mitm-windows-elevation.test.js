// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import MitmServerCard from "@/app/(dashboard)/dashboard/cli-tools/components/MitmServerCard.js";

const repoRoot = path.basename(process.cwd()) === "tests" ? path.resolve(process.cwd(), "..") : process.cwd();
const testsRoot = path.join(repoRoot, "tests");
const require = createRequire(path.join(testsRoot, "package.json"));
const dnsConfigPath = path.join(repoRoot, "src/mitm/dns/dnsConfig.js");
const winElevatedPath = path.join(repoRoot, "src/mitm/winElevated.js");
const { TOOL_HOSTS } = require(path.join(repoRoot, "src/shared/constants/mitmToolHosts.js"));

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  getMitmStatus: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  enableToolDNS: vi.fn(),
  disableToolDNS: vi.fn(),
  trustCert: vi.fn(),
  getCachedPassword: vi.fn(),
  setCachedPassword: vi.fn(),
  loadEncryptedPassword: vi.fn(),
  isSudoPasswordRequired: vi.fn(),
  initDbHooks: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
}));

vi.mock("child_process", async (importOriginal) => ({
  ...await importOriginal(),
  execSync: mocks.execSync,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: mocks.getMitmStatus,
  startServer: mocks.startServer,
  stopServer: mocks.stopServer,
  enableToolDNS: mocks.enableToolDNS,
  disableToolDNS: mocks.disableToolDNS,
  trustCert: mocks.trustCert,
  getCachedPassword: mocks.getCachedPassword,
  setCachedPassword: mocks.setCachedPassword,
  loadEncryptedPassword: mocks.loadEncryptedPassword,
  isSudoPasswordRequired: mocks.isSudoPasswordRequired,
  initDbHooks: mocks.initDbHooks,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let mountedRoot = null;
let mountedContainer = null;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value });
}

function requestJson(body) {
  return {
    json: vi.fn().mockResolvedValue(body),
  };
}

function runWindowsDnsOperation(operation, hostsContent) {
  const script = `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const output = process.stdout.write.bind(process.stdout);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-mitm-windows-"));
    const hostsPath = path.join(root, "System32", "drivers", "etc", "hosts");
    fs.mkdirSync(path.dirname(hostsPath), { recursive: true });
    fs.writeFileSync(hostsPath, ${JSON.stringify(hostsContent)}, "utf8");
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.SystemRoot = root;
    const elevatedCalls = [];
    const elevatedPath = require.resolve(${JSON.stringify(winElevatedPath)});
    require.cache[elevatedPath] = {
      id: elevatedPath,
      filename: elevatedPath,
      loaded: true,
      exports: {
        quotePs(value) { return "'" + String(value).replace(/'/g, "''") + "'"; },
        runElevatedPowerShell: async (command) => { elevatedCalls.push(command); },
      },
    };
    console.log = () => {};
    const dnsConfig = require(${JSON.stringify(dnsConfigPath)});
    dnsConfig[${JSON.stringify(operation)}]("antigravity", "")
      .then(() => output(JSON.stringify({ elevatedCalls })))
      .catch((error) => { process.stderr.write(error.stack); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function runWindowsUacWrapper() {
  const script = `
    const output = process.stdout.write.bind(process.stdout);
    Object.defineProperty(process, "platform", { value: "win32" });
    const childProcess = require("child_process");
    const execCalls = [];
    const execFileCalls = [];
    childProcess.execSync = () => { throw new Error("not elevated"); };
    childProcess.exec = (command, options, callback) => {
      execCalls.push({ command, options });
      callback(null, "", "");
    };
    childProcess.execFile = (file, args, options, callback) => {
      execFileCalls.push({ file, args, options });
      callback(null, "", "");
    };
    const { runElevatedPowerShell } = require(${JSON.stringify(winElevatedPath)});
    runElevatedPowerShell("Write-Output 'ready'")
      .then(() => output(JSON.stringify({ execCalls, execFileCalls })))
      .catch((error) => { process.stderr.write(error.stack); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function expectSingleElevatedHostsOperation(operation, hostsContent, listName) {
  const { elevatedCalls } = runWindowsDnsOperation(operation, hostsContent);

  expect(elevatedCalls).toHaveLength(1);
  expect(elevatedCalls[0]).toContain(listName);
  expect(elevatedCalls[0]).toContain("New-Object System.Text.UTF8Encoding($false)");
  expect(elevatedCalls[0]).toContain("[System.IO.File]::WriteAllBytes");
  expect(elevatedCalls[0]).not.toContain("Set-Content -LiteralPath");
  expect(elevatedCalls[0]).toContain("[regex]::Escape($hostName)");
  expect(elevatedCalls[0]).toContain("ipconfig /flushdns | Out-Null");
  for (const host of TOOL_HOSTS.antigravity) {
    expect(elevatedCalls[0]).toContain(`'${host}'`);
  }
}

describe("MITM Windows elevation", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.resetModules();
    setPlatform("win32");
    mocks.execSync.mockImplementation(() => {
      throw new Error("not elevated");
    });
    mocks.getCachedPassword.mockReturnValue(null);
    mocks.loadEncryptedPassword.mockResolvedValue("");
    mocks.startServer.mockResolvedValue({ running: true, pid: 1234 });
  });

  afterEach(() => {
    if (mountedRoot) act(() => mountedRoot.unmount());
    mountedContainer?.remove();
    mountedRoot = null;
    mountedContainer = null;
    vi.unstubAllGlobals();
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("reaches the UAC-capable MITM start path when Windows is not elevated", async () => {
    const { POST } = await import("../../src/app/api/cli-tools/antigravity-mitm/route.js");

    const response = await POST(requestJson({ apiKey: "sk-test" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, running: true, pid: 1234 });
    expect(mocks.startServer).toHaveBeenCalledWith("sk-test", "", false);
  });

  it("keeps the non-Windows sudo-password requirement", async () => {
    setPlatform("linux");
    vi.resetModules();
    mocks.isSudoPasswordRequired.mockReturnValue(true);
    const { POST } = await import("../../src/app/api/cli-tools/antigravity-mitm/route.js");

    const response = await POST(requestJson({ apiKey: "sk-test" }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Missing sudoPassword" });
    expect(mocks.startServer).not.toHaveBeenCalled();
  });

  it("adds Windows hosts and flushes DNS in one elevated operation", () => {
    const hostsContent = `127.0.0.1 ${TOOL_HOSTS.antigravity[0]}\r\n`;
    expectSingleElevatedHostsOperation("addDNSEntry", hostsContent, "$hostsToAdd");
  });

  it("removes Windows hosts and flushes DNS in one elevated operation", () => {
    const hostsContent = `127.0.0.1 ${TOOL_HOSTS.antigravity[0]}\r\n`;
    expectSingleElevatedHostsOperation("removeDNSEntry", hostsContent, "$hostsToRemove");
  });

  it("launches the non-admin UAC wrapper with encoded execFile arguments", () => {
    const { execCalls, execFileCalls } = runWindowsUacWrapper();

    expect(execCalls).toHaveLength(0);
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].file).toBe("powershell");
    expect(execFileCalls[0].args).toContain("-EncodedCommand");
    expect(execFileCalls[0].args).not.toContain("-Command");
    const encoded = execFileCalls[0].args[execFileCalls[0].args.indexOf("-EncodedCommand") + 1];
    const wrapper = Buffer.from(encoded, "base64").toString("utf16le");
    expect(wrapper).toContain("Start-Process powershell");
    expect(wrapper).toContain("-EncodedCommand");
  });

  it("lets a non-admin Windows user start MITM through the UAC prompt", async () => {
    const windowsStatus = {
      running: false,
      certExists: false,
      certTrusted: false,
      dnsStatus: {},
      isWin: true,
      isAdmin: false,
      hasCachedPassword: false,
      needsSudoPassword: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => windowsStatus,
    });
    vi.stubGlobal("fetch", fetchMock);
    mountedContainer = document.createElement("div");
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    await act(async () => {
      mountedRoot.render(<MitmServerCard apiKeys={[{ id: "key-1", key: "sk-test" }]} cloudEnabled={false} />);
    });
    await act(async () => { await Promise.resolve(); });

    const startButton = [...mountedContainer.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Start Server"));
    expect(startButton).toBeDefined();
    expect(startButton.disabled).toBe(false);
    expect(mountedContainer.textContent).toContain("Windows will ask for administrator permission when you start MITM");

    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    const startCall = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(startCall).toBeDefined();
    expect(JSON.parse(startCall[1].body)).toMatchObject({ apiKey: "sk-test", sudoPassword: "" });
  });
});
