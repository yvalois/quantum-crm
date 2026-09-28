import { connection } from "next/server";

export default async function SignedOutPage() {
  await connection();

  return (
    <main className="public-shell">
      <section className="public-panel">
        <p className="eyebrow">Quantum Admin</p>
        <h1>Sesión cerrada</h1>
        <p>Tu sesión administrativa se cerró correctamente.</p>
        <a href="/api/auth/login?returnTo=%2Fdashboard">Volver a ingresar</a>
      </section>
    </main>
  );
}
