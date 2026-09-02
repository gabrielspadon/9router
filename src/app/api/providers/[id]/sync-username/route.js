import { NextResponse } from "next/server";
import { getProviderConnectionById, mergeProviderConnectionData } from "@/models";
import { GITHUB_CONFIG } from "@/lib/oauth/constants/oauth";
import { resolveConnectionProxyConfig, toConnectionProxyOptions } from "@/lib/network/connectionProxy";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";

function error(message, status) {
  return NextResponse.json({ error: message }, { status });
}

function connectionData(connection) {
  const data = connection?.providerSpecificData;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

// POST /api/providers/[id]/sync-username - Refresh a GitHub connection's login name.
export async function POST(_request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) return error("Connection not found", 404);
    if (connection.provider !== "github") {
      return error("Username sync is only available for GitHub connections", 400);
    }
    if (!connection.accessToken) return error("GitHub authorization is unavailable", 401);

    const proxyConfig = await resolveConnectionProxyConfig(connectionData(connection));
    if (proxyConfig?.kind !== "usable") return error("Required proxy is unavailable", 503);

    const response = await proxyAwareFetch(GITHUB_CONFIG.userInfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
      signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS),
    }, toConnectionProxyOptions(proxyConfig));

    if (response.status === 401) return error("GitHub authorization is unavailable", 401);
    if (!response.ok) return error("Unable to sync GitHub username", 502);

    const profile = await response.json().catch(() => null);
    const username = typeof profile?.login === "string" ? profile.login.trim() : "";
    if (!username) return error("Unable to sync GitHub username", 502);

    if (!await mergeProviderConnectionData(id, {
      name: username,
      providerSpecificData: { githubLogin: username },
    })) return error("Connection not found", 404);

    return NextResponse.json({ username });
  } catch {
    return error("Unable to sync GitHub username", 500);
  }
}
