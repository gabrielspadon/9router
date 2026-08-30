import { getProviderConnectionById } from "@/lib/db/index.js";
import {
  antigravityVerificationJson,
  authorizeAntigravityVerification,
  authorizeAntigravityVerificationMutation,
  withAntigravityVerificationHeaders,
} from "@/lib/auth/antigravityVerificationAccess";
import {
  clearAntigravityVerificationIfCurrent,
  getAntigravityVerification,
} from "@/lib/antigravityVerification";

function notFound() {
  return antigravityVerificationJson({ error: "Verification challenge not found" }, { status: 404 });
}

function challengeChanged() {
  return antigravityVerificationJson({ error: "Verification challenge changed" }, { status: 409 });
}

async function loadCurrentAntigravityChallenge(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.provider !== "antigravity") return null;
  const verification = getAntigravityVerification(connectionId);
  return verification ? { connection, verification } : null;
}

export async function GET(request, { params }) {
  const authorization = await authorizeAntigravityVerification(request);
  if (!authorization.ok) return authorization.response;

  const { connectionId } = await params;
  const current = await loadCurrentAntigravityChallenge(connectionId);
  if (!current) return notFound();

  return antigravityVerificationJson({
    challengeId: current.verification.challengeId,
    expiresAt: current.verification.expiresAt,
    href: current.verification.href,
  });
}

export async function DELETE(request, { params }) {
  const authorization = await authorizeAntigravityVerificationMutation(request);
  if (!authorization.ok) return authorization.response;

  const { connectionId } = await params;
  const current = await loadCurrentAntigravityChallenge(connectionId);
  if (!current) return notFound();

  let body;
  try {
    body = await request.json();
  } catch {
    return challengeChanged();
  }
  if (body?.challengeId !== current.verification.challengeId) return challengeChanged();
  if (!clearAntigravityVerificationIfCurrent(connectionId, body.challengeId)) return challengeChanged();

  return new Response(null, { status: 204, headers: withAntigravityVerificationHeaders() });
}
