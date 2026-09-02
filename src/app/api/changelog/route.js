import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The changelog ships inside the product, so the dashboard reads no external
// repository feed. Traced into the standalone build by next.config.mjs.
export async function GET() {
  try {
    const md = await readFile(join(process.cwd(), "CHANGELOG.md"), "utf8");
    return new Response(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Changelog unavailable.", { status: 404 });
  }
}
