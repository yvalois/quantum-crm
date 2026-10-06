import { connection } from "next/server";

interface BootstrapPageProps {
  readonly searchParams: Promise<{ readonly access?: string }>;
}

export default async function BootstrapPage({ searchParams }: BootstrapPageProps) {
  await connection();
  const { access } = await searchParams;
  const recoveryMessage =
    access === "expired"
      ? "La ventana de ingreso venció. Inicia nuevamente para crear una sesión nueva."
      : access === "failed"
        ? "No fue posible completar el ingreso. Tus credenciales no cambiaron; vuelve a intentarlo."
        : null;

  return (
    <main className="public-shell">
      <section className="public-panel">
        <p className="eyebrow">Operadores de Quantum</p>
        <h1>Quantum Admin</h1>
        <p>Acceso protegido al centro de control de la plataforma.</p>
        {recoveryMessage ? (
          <p className="public-notice" role="status">
            {recoveryMessage}
          </p>
        ) : null}
        <div className="public-actions">
          <a href="/api/auth/login?returnTo=%2Fdashboard">Ingresar a Quantum Admin</a>
          <p>
            En el primer acceso, define tu contraseña y configura el código TOTP desde tu aplicación
            autenticadora. Para cada ingreso usa un código nuevo.
          </p>
        </div>
        <p className="public-help">
          Las cuentas de operador se habilitan desde Quantum. Si aún no tienes una, solicita el
          acceso al responsable de la plataforma.
        </p>
      </section>
    </main>
  );
}
