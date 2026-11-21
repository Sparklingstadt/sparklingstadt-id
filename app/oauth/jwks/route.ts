import { getOidcConfig } from "@/lib/id/config";

export const runtime = "nodejs";
// Reads env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export async function GET() {
  let keys: ReturnType<typeof getOidcConfig>["publicKeys"];
  try {
    // publicKeys already holds the current signing key's public JWK plus previous keys.
    ({ publicKeys: keys } = getOidcConfig());
  } catch {
    return Response.json(
      { error: "server_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { keys },
    { headers: { "Cache-Control": "public, max-age=600" } },
  );
}
