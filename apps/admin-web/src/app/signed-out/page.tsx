import { connection } from "next/server";

export default async function SignedOutPage() {
  await connection();

  return (
    <main>
      <p className="eyebrow">Quantum Admin</p>
      <h1>Sesion cerrada</h1>
      <p>Tu sesion administrativa se cerro correctamente.</p>
      <a href="/api/auth/login">Volver a ingresar</a>
    </main>
  );
}
