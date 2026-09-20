import { connection } from "next/server";

export default async function BootstrapPage() {
  await connection();

  return (
    <main className="public-shell">
      <section className="public-panel">
        <p className="eyebrow">Operadores de Quantum</p>
        <h1>Quantum Admin</h1>
        <p>Acceso protegido al centro de control de la plataforma.</p>
        <a href="/api/auth/login">Ingresar con identidad Quantum</a>
      </section>
    </main>
  );
}
