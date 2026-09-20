import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="admin-content">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">PLATAFORMA QUANTUM / RESUMEN</p>
          <h1>Centro de control</h1>
          <p>
            Supervisa la estructura operativa sin entrar a los datos comerciales de tus clientes.
          </p>
        </div>
        <span className="live-stamp">ACTUALIZACIÓN EN VIVO</span>
      </section>

      <section className="control-grid" aria-label="Capacidades de plataforma">
        <Link className="control-card control-card-featured" href="/dashboard/tenants">
          <span className="card-index">01</span>
          <div>
            <p>GESTIÓN DISPONIBLE</p>
            <h2>Perfiles de clientes</h2>
            <span>Crea empresas, consulta su estado y conserva su identidad operativa.</span>
          </div>
          <b aria-hidden="true">↗</b>
        </Link>
        <article className="control-card is-planned">
          <span className="card-index">02</span>
          <div>
            <p>SIGUIENTE FASE</p>
            <h2>Infraestructura</h2>
            <span>Capacidad, asignaciones y salud observada por servidor.</span>
          </div>
        </article>
        <article className="control-card is-planned">
          <span className="card-index">03</span>
          <div>
            <p>SIGUIENTE FASE</p>
            <h2>Operaciones</h2>
            <span>Despliegues tipados, progreso y recuperación verificable.</span>
          </div>
        </article>
      </section>

      <section className="boundary-note">
        <span aria-hidden="true">◎</span>
        <div>
          <strong>Frontera administrativa activa</strong>
          <p>
            Quantum administra perfiles y despliegues. Los contactos, conversaciones y ventas
            permanecen dentro de cada CRM aislado.
          </p>
        </div>
      </section>
    </main>
  );
}
