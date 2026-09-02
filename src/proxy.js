import { NextResponse } from "next/server";
import { proxy as dashboardProxy } from "./dashboardGuard";

export default async function proxy(request) {
  try {
    return await dashboardProxy(request);
  } catch (error) {
    // Nothing else in the request path can answer once middleware throws: Next
    // returns its own plain-text "Internal Server Error", so a dashboard call
    // that parses the body as JSON reports a parse error instead of the real
    // failure (#3441). Answer in the shape every caller here already expects,
    // and keep the cause in the server log where it belongs rather than in the
    // response.
    console.error("[tokenproxy] middleware failed:", error);
    return NextResponse.json(
      { error: "Request could not be processed" },
      { status: 500 },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
