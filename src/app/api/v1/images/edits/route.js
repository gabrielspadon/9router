import { handleImageEdits } from "@/sse/handlers/imageEdits.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/images/edits - OpenAI-compatible image edit endpoint */
export async function POST(request) {
  return await handleImageEdits(request);
}
