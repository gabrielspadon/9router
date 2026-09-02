import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

const cursorHandler = require(resolve(repoRoot, "src/mitm/handlers/cursor.js"));
const { TOOL_HOSTS } = require(resolve(repoRoot, "src/shared/constants/mitmToolHosts.js"));
const { getToolForHost, isChatRequest } = require(resolve(repoRoot, "src/mitm/config.js"));

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(chunk) { if (chunk) this.body += chunk; },
  };
}

// #2420 asks for MITM interception of Cursor. Interception is NOT implemented —
// only the client half of Cursor's Connect-RPC protobuf exists in this tree — so
// the bar is that the handler must not damage the IDE it cannot serve.
describe("Cursor MITM declines without breaking Cursor (#2420)", () => {
  it("forwards to the real upstream instead of answering 501", async () => {
    const passthrough = vi.fn(async () => "forwarded");
    const req = { url: "/aiserver.v1.ChatService/RunSSE", headers: { host: "api2.cursor.sh" } };
    const res = makeRes();
    const body = Buffer.from("binary-proto");

    await cursorHandler.intercept(req, res, body, null, passthrough);

    expect(passthrough).toHaveBeenCalledWith(req, res, body);
    // A 501 here is what took the IDE down: the host is pinned to 127.0.0.1 for
    // the whole machine while the proxy runs, so nothing else answers it.
    expect(res.statusCode).toBeNull();
  });

  it("still answers explicitly when no forwarder is supplied", async () => {
    const res = makeRes();
    await cursorHandler.intercept({ url: "/Run", headers: {} }, res, Buffer.alloc(0), null, undefined);

    expect(res.statusCode).toBe(501);
    expect(JSON.parse(res.body).error.type).toBe("not_implemented");
  });

  it("pins only Cursor's API host, not a site the user browses", () => {
    // The reason this tool is safe to leave wired at all: enabling it redirects
    // api2.cursor.sh only. cursor.com — the website — is never touched.
    expect(TOOL_HOSTS.cursor).toEqual(["api2.cursor.sh"]);
    expect(TOOL_HOSTS.cursor.some((h) => h === "cursor.com" || h === "www.cursor.com")).toBe(false);
    expect(getToolForHost("cursor.com")).toBeNull();
    expect(getToolForHost("api2.cursor.sh")).toBe("cursor");
  });

  it("only chat paths reach the handler at all", () => {
    expect(isChatRequest("cursor", { url: "/aiserver.v1.ChatService/RunSSE" })).toBe(true);
    expect(isChatRequest("cursor", { url: "/auth/poll" })).toBe(false);
  });
});
