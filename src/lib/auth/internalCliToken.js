import { getConsistentMachineId } from "@/shared/utils/machineId";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

const CLI_TOKEN_HEADER = "x-tp-cli-token";
const CLI_TOKEN_SALT = "tp-cli-auth";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

let cachedCliToken = null;

async function getCliToken() {
  if (!cachedCliToken) {
    cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  }
  return cachedCliToken;
}

export function isLoopbackInternalUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isTrustedDirectLoopbackPeer(request) {
  if (!hasTrustedPeerHeaders(request) || request.headers.has("x-tp-via-proxy")) return false;
  const peerIp = String(request.headers.get("x-tp-real-ip") || "").trim().toLowerCase();
  return LOOPBACK_PEERS.has(peerIp);
}

export async function isInternalModelTestAuthorized(request, apiKey, validateApiKey) {
  if (isLoopbackInternalUrl(request.url) && isTrustedDirectLoopbackPeer(request)) {
    const suppliedToken = request.headers.get(CLI_TOKEN_HEADER);
    if (suppliedToken && suppliedToken === (await getCliToken())) return true;
  }
  return apiKey ? await validateApiKey(apiKey) : false;
}
