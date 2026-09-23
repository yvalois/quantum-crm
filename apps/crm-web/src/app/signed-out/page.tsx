import Link from "next/link";

export default function SignedOutPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Quantum CRM</p>
      <h1>Sesión cerrada</h1>
      <p>Tu sesión de empresa se cerró de forma segura.</p>
      <Link className="primary-action" href="/api/auth/login">
        Iniciar sesión
      </Link>
    </main>
  );
}
