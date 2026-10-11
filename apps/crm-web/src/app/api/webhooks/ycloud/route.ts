import { loadCrmWebAuthConfig } from "@quantum-crm/config";

export const dynamic = "force-dynamic";

/** Public transport only. The tenant API validates YCloud's raw-body signature. */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("ycloud-signature");
  if (!signature) return new Response(null, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 1_048_576)
    return new Response(null, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > 1_048_576) return new Response(null, { status: 413 });
  try {
    const config = loadCrmWebAuthConfig();
    const upstream = await fetch(new URL("/api/v1/webhooks/ycloud", config.crmApiOrigin), {
      method: "POST",
      headers: { "content-type": "application/json", "ycloud-signature": signature },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(null, { status: upstream.status, headers: { "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
