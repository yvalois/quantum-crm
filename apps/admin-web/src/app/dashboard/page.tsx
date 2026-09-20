import { SecretValue } from "@quantum-crm/config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { platformSessionCookieName } from "../../server/platform-auth-http";
import { getPlatformAuthRuntime } from "../../server/platform-auth-runtime";

export default async function DashboardPage() {
  const runtime = await getPlatformAuthRuntime();
  const handle = (await cookies()).get(platformSessionCookieName(runtime.config))?.value;
  const session = handle ? await runtime.auth.session(new SecretValue(handle)) : null;
  if (!session) redirect("/api/auth/login?returnTo=%2Fdashboard");

  return (
    <main>
      <p className="eyebrow">Plataforma Quantum</p>
      <h1>Panel administrativo</h1>
      <p>Sesion verificada. Los modulos operativos se habilitaran por permiso.</p>
    </main>
  );
}
