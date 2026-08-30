import { getProviderConnectionById } from "@/lib/db/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import {
  antigravityVerificationJson,
  authorizeAntigravityVerificationMutation,
} from "@/lib/auth/antigravityVerificationAccess";
import {
  getAntigravityVerification,
  runAntigravityUsageProbe,
} from "@/lib/antigravityVerification";
import { isUsableAntigravityUsageResult } from "open-sse/services/usage/google.js";

function notFound() {
  return antigravityVerificationJson({ error: "Verification challenge not found" }, { status: 404 });
}

function challengeChanged() {
  return antigravityVerificationJson({ error: "Verification challenge changed" }, { status: 409 });
}

function recheckFailed(status = 502) {
  return antigravityVerificationJson({ error: "Verification recheck failed" }, { status });
}

function mappedStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function proxyOptionsFrom(proxyConfig) {
  return {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };
}

export async function POST(request, { params }) {
  const authorization = await authorizeAntigravityVerificationMutation(request);
  if (!authorization.ok) return authorization.response;

  const { connectionId } = await params;
  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.provider !== "antigravity") return notFound();

  const current = getAntigravityVerification(connectionId);
  if (!current) return notFound();

  let body;
  try {
    body = await request.json();
  } catch {
    return challengeChanged();
  }
  const submittedId = body?.challengeId;
  if (typeof submittedId !== "string" || submittedId !== current.challengeId) return challengeChanged();

  try {
    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    const result = await runAntigravityUsageProbe(connection, proxyOptionsFrom(proxyConfig), {
      force: true,
      expectedChallengeId: submittedId,
    });
    if (!isUsableAntigravityUsageResult(result)) return recheckFailed();

    const after = getAntigravityVerification(connectionId);
    if (!after) return antigravityVerificationJson({ verified: true });
    if (after.challengeId !== submittedId) return antigravityVerificationJson({ verified: false });
    return recheckFailed();
  } catch (error) {
    return recheckFailed(mappedStatus(error));
  }
}
