import { createHealthStatus } from "@quantum-crm/contracts";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(createHealthStatus({ service: "portal-web", check: "live" }), {
    headers: {
      "cache-control": "no-store",
    },
  });
}
