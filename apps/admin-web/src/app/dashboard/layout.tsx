import { SecretValue } from "@quantum-crm/config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { platformSessionCookieName } from "../../server/platform-auth-http";
import { getPlatformAuthRuntime } from "../../server/platform-auth-runtime";
import { AdminShell } from "./admin-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  const runtime = await getPlatformAuthRuntime();
  const handle = (await cookies()).get(platformSessionCookieName(runtime.config))?.value;
  const session = handle ? await runtime.auth.session(new SecretValue(handle)) : null;
  if (!session) redirect("/api/auth/login?returnTo=%2Fdashboard");

  return <AdminShell>{children}</AdminShell>;
}
