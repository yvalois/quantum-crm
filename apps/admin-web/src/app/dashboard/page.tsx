import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="admin-content">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">CONTROL-PLANE / PLATFORM STATUS</p>
          <h1>Resumen de plataforma</h1>
          <p>
            Supervisa la estructura operativa sin entrar a los datos comerciales de tus clientes.
          </p>
        </div>
        <div className="dashboard-stamp">
          <span className="live-stamp">LECTURA OPERATIVA</span>
          <span>Datos reales · sin telemetría simulada</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Estado de las capacidades de plataforma">
        <Link className="metric-card metric-card-primary" href="/dashboard/tenants">
          <div className="metric-card-head">
            <span className="card-index">01 / TENANTS</span>
            <span className="status status-active">Disponible</span>
          </div>
          <strong>Perfiles y entornos</strong>
          <p>Consulta, filtra y administra la identidad operativa de cada empresa.</p>
          <span className="metric-link">
            Abrir directorio <b aria-hidden="true">↗</b>
          </span>
        </Link>
        <article className="metric-card">
          <div className="metric-card-head">
            <span className="card-index">02 / ACCESS</span>
            <span className="status status-active">Protegido</span>
          </div>
          <strong>Acceso administrativo</strong>
          <p>Sesión opaca, MFA y permisos comprobados en el servidor.</p>
          <span className="metric-code">OIDC · MFA · SERVER SESSION</span>
        </article>
        <article className="metric-card metric-card-muted">
          <div className="metric-card-head">
            <span className="card-index">03 / OPS</span>
            <span className="status status-pending">Planificado</span>
          </div>
          <strong>Operaciones de plataforma</strong>
          <p>Releases, infraestructura, backups e incidentes se conectarán aquí.</p>
          <span className="metric-code">SIN DATOS FICTICIOS</span>
        </article>
      </section>

      <section className="dashboard-panels">
        <article className="system-panel">
          <header className="system-panel-head">
            <div>
              <span className="section-code">SURFACE / 01</span>
              <h2>Superficies conectadas</h2>
            </div>
            <span className="panel-live">ESTADO ACTUAL</span>
          </header>
          <div className="surface-list">
            <div className="surface-row">
              <span className="surface-dot is-live" aria-hidden="true" />
              <div>
                <strong>Identidad y sesión</strong>
                <span>OIDC · MFA · cookies opacas</span>
              </div>
              <b>OPERATIVA</b>
            </div>
            <div className="surface-row">
              <span className="surface-dot is-live" aria-hidden="true" />
              <div>
                <strong>Directorio de tenants</strong>
                <span>BFF protegido · contratos v1</span>
              </div>
              <b>OPERATIVA</b>
            </div>
            <div className="surface-row">
              <span className="surface-dot is-planned" aria-hidden="true" />
              <div>
                <strong>Orquestación y continuidad</strong>
                <span>Releases · VPS · backups</span>
              </div>
              <b>EN PLAN</b>
            </div>
          </div>
        </article>
        <article className="system-panel boundary-panel">
          <header className="system-panel-head">
            <div>
              <span className="section-code">BOUNDARY / 02</span>
              <h2>Frontera administrativa</h2>
            </div>
            <span className="boundary-icon" aria-hidden="true">
              Q
            </span>
          </header>
          <p>
            Quantum administra perfiles y despliegues. Los contactos, conversaciones y ventas
            permanecen dentro de cada CRM aislado.
          </p>
          <div className="boundary-tags">
            <span>DATOS COMERCIALES AISLADOS</span>
            <span>MINIMO PRIVILEGIO</span>
          </div>
        </article>
      </section>
    </main>
  );
}
