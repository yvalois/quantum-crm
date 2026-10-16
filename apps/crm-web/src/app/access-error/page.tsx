import Link from "next/link";

export default function AccessErrorPage() {
  return (
    <main className="auth-page">
      <p className="eyebrow">Acceso al CRM</p>
      <h1>No se completó el inicio de sesión</h1>
      <p>
        Si cerraste el cambio de contraseña o la configuración del autenticador, inicia de nuevo. Si
        estabas usando un enlace de activación anterior, pide al administrador de Quantum que genere
        uno nuevo.
      </p>
      <Link className="primary-action" href="/api/auth/login?returnTo=%2Finbox">
        Intentar de nuevo
      </Link>
    </main>
  );
}
