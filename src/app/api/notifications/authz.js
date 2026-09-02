// Not a route — the shared write gate for /api/notifications.
//
// dashboardGuard already refuses these paths unauthenticated (deny-by-default
// for /api/*), but it lets ANY caller through once requireLogin is off. Webhook
// config is instance-wide and outbound-capable — a URL written here is a target
// this server will POST to, and it carries a signing secret — so it gets the
// same stricter gate src/dashboardGuard.js:280-291 already applies to settings
// writes: a real session, the CLI token, or a loopback caller.
import { hasValidCliToken, isLocalRequest } from "@/dashboardGuard";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export async function canWriteNotifications(request) {
  if (await hasValidCliToken(request)) return true;
  if (await verifyDashboardAuthToken(request.cookies?.get?.("auth_token")?.value)) return true;
  return isLocalRequest(request);
}
