"use client";

import {
  CrmPermissionCatalog,
  type CrmPermission,
  type Member,
  type Role,
  type Team,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface MemberListPayload {
  readonly data: Member[];
}

interface RoleListPayload {
  readonly data: Role[];
}

interface TeamListPayload {
  readonly data: Team[];
}

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface InvitationPayload {
  readonly activation?: {
    readonly url: string;
    readonly expiresAt: string;
  };
}

const permissionSections = Array.from(
  new Set(CrmPermissionCatalog.map((permission) => permission.split(":").slice(0, 2).join(":"))),
);

function memberStatus(status: Member["status"]): string {
  return { ACTIVE: "Activo", DEACTIVATED: "Desactivado", INVITED: "Invitado" }[status];
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(value));
}

async function responseMessage(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (
    payload !== null &&
    typeof payload === "object" &&
    "title" in payload &&
    typeof payload.title === "string"
  ) {
    return payload.title;
  }
  return "No fue posible completar la solicitud.";
}

export function MembersPanel(): React.JSX.Element {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsAvailable, setTeamsAvailable] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationLink, setActivationLink] = useState<InvitationPayload["activation"]>();
  const [saving, setSaving] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCommercialScope, setEditCommercialScope] =
    useState<Member["commercialScope"]>("ASSIGNED");
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleDisplayName, setRoleDisplayName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<CrmPermission[]>([]);
  const invitationKey = useRef<string | null>(null);

  const loadMembers = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/members?limit=100", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) {
      window.location.assign("/api/auth/login?returnTo=/");
      return;
    }
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = (await response.json()) as MemberListPayload;
    setMembers(payload.data);
  }, []);

  const loadRoles = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/roles", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 403) {
      setRoles([]);
      return;
    }
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = (await response.json()) as RoleListPayload;
    setRoles(payload.data);
  }, []);

  const loadTeams = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/teams", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 403) {
      setTeamsAvailable(false);
      setTeams([]);
      return;
    }
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = (await response.json()) as TeamListPayload;
    setTeams(payload.data);
    setTeamsAvailable(true);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/");
          return;
        }
        if (!response.ok) throw new Error(await responseMessage(response));
        const session = (await response.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (!active) return;
        setCsrfToken(session.csrfToken);
        await Promise.all([loadMembers(), loadRoles(), loadTeams()]);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar miembros.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [loadMembers, loadRoles, loadTeams]);

  const refresh = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setActivationLink(undefined);
    setLoading(true);
    try {
      await Promise.all([loadMembers(), loadRoles(), loadTeams()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar miembros.");
    } finally {
      setLoading(false);
    }
  };

  const createTeam = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!csrfToken || !newTeamName.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setActivationLink(undefined);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ name: newTeamName }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNewTeamName("");
      setNotice("Equipo creado.");
      await loadTeams();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el equipo.");
    } finally {
      setSaving(false);
    }
  };

  const addTeamMember = async (team: Team, memberId: string): Promise<void> => {
    if (!csrfToken || !memberId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/teams/${team.id}/members`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ memberId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice("Miembro agregado al equipo.");
      await loadTeams();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible agregar el miembro.");
    } finally {
      setSaving(false);
    }
  };

  const removeTeamMember = async (team: Team, memberId: string): Promise<void> => {
    if (!csrfToken) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/teams/${team.id}/members/${memberId}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice("Miembro retirado del equipo.");
      await loadTeams();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible retirar el miembro.");
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!csrfToken || !roleDisplayName.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(editingRole ? `/api/roles/${editingRole.id}` : "/api/roles", {
        method: editingRole ? "PATCH" : "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ displayName: roleDisplayName, permissions: rolePermissions }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setEditingRole(null);
      setRoleDisplayName("");
      setRolePermissions([]);
      setNotice(editingRole ? "Rol personalizado actualizado." : "Rol personalizado creado.");
      await loadRoles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el rol.");
    } finally {
      setSaving(false);
    }
  };

  const beginEditingRole = (role: Role): void => {
    if (role.system) return;
    setEditingRole(role);
    setRoleDisplayName(role.displayName);
    setRolePermissions([...role.permissions]);
    setError(null);
    setNotice(null);
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!csrfToken) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setNotice(null);
    const idempotencyKey = invitationKey.current ?? crypto.randomUUID();
    invitationKey.current = idempotencyKey;
    try {
      const response = await fetch("/api/members/invitations", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          email: form.get("email"),
          roleCode: form.get("roleCode"),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as InvitationPayload;
      event.currentTarget.reset();
      invitationKey.current = null;
      setActivationLink(payload.activation);
      setNotice("Invitación registrada. Comparte el enlace de activación con el miembro.");
      await loadMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la invitación.");
    } finally {
      setSaving(false);
    }
  };

  const saveMember = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!csrfToken || !editingMember) return;
    const scopeChanged = editCommercialScope !== editingMember.commercialScope;
    const profileChanged =
      editDisplayName !== editingMember.displayName || editEmail !== editingMember.email;
    if (scopeChanged && profileChanged) {
      setError("Guarda el nombre/correo y el alcance en operaciones separadas.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      };
      if (scopeChanged) headers["if-match"] = `"${editingMember.authorizationRevision}"`;
      const response = await fetch(`/api/members/${editingMember.id}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(
          scopeChanged
            ? { commercialScope: editCommercialScope }
            : { displayName: editDisplayName, email: editEmail },
        ),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setEditingMember(null);
      setNotice("Datos del miembro actualizados.");
      await loadMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar el miembro.");
    } finally {
      setSaving(false);
    }
  };

  const deactivateMember = async (member: Member): Promise<void> => {
    if (!csrfToken || !window.confirm(`¿Desactivar a ${member.displayName}?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/members/${member.id}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      if (editingMember?.id === member.id) setEditingMember(null);
      setNotice("Miembro desactivado.");
      await loadMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible desactivar el miembro.");
    } finally {
      setSaving(false);
    }
  };

  const revokeInvitation = async (member: Member): Promise<void> => {
    if (!csrfToken || !window.confirm(`¿Revocar la invitación de ${member.displayName}?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/members/${member.id}/invitation/revoke`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice("Invitación revocada.");
      await loadMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible revocar la invitación.");
    } finally {
      setSaving(false);
    }
  };

  const beginEditing = (member: Member): void => {
    setEditingMember(member);
    setEditDisplayName(member.displayName);
    setEditEmail(member.email);
    setEditCommercialScope(member.commercialScope);
    setError(null);
    setNotice(null);
  };

  const logout = async (): Promise<void> => {
    if (!csrfToken) return;
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
        redirect: "manual",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      window.location.assign(response.headers.get("location") ?? "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cerrar la sesión.");
    }
  };

  return (
    <main className="crm-shell">
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span>Quantum</span>
        </a>
        <nav>
          <a href="/" aria-current="page">
            Equipo
          </a>
          <a href="/contacts">Contactos</a>
          <a href="/pipeline">Pipeline</a>
          <a href="/tasks">Tareas</a>
        </nav>
        <div className="sidebar-footer">
          <button type="button" onClick={() => void logout()} disabled={!csrfToken}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <section className="crm-content" aria-busy={loading}>
        <header className="page-header">
          <div>
            <p className="eyebrow">Administración</p>
            <h1>Equipo</h1>
            <p>Gestiona las personas que pueden trabajar dentro de tu espacio de CRM.</p>
          </div>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Actualizar
          </button>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="feedback feedback-success" role="status">
            {notice}
          </p>
        ) : null}
        {activationLink ? (
          <p className="feedback feedback-success" role="status">
            <a href={activationLink.url} target="_blank" rel="noreferrer">
              Abrir activación
            </a>{" "}
            <small>Válida hasta {dateLabel(activationLink.expiresAt)}.</small>
          </p>
        ) : null}

        <div className="member-layout">
          <section className="member-card" aria-labelledby="members-heading">
            <div className="card-heading">
              <div>
                <h2 id="members-heading">Miembros</h2>
                <p>{members.length} registrados en este espacio</p>
              </div>
            </div>
            {loading ? <p className="state-message">Cargando equipo…</p> : null}
            {!loading && members.length === 0 ? (
              <p className="state-message">Aún no hay miembros registrados.</p>
            ) : null}
            {!loading && members.length > 0 ? (
              <ul className="member-list">
                {members.map((member) => (
                  <li key={member.id} className="member-row">
                    <div className="member-avatar" aria-hidden="true">
                      {member.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="member-details">
                      <strong>{member.displayName}</strong>
                      <span>{member.email}</span>
                      <small>Desde {dateLabel(member.createdAt)}</small>
                      <small>Alcance: {member.commercialScope.toLowerCase()}</small>
                    </div>
                    <span className={`status status-${member.status.toLowerCase()}`}>
                      {memberStatus(member.status)}
                    </span>
                    <div className="member-actions">
                      <button type="button" onClick={() => beginEditing(member)} disabled={saving}>
                        Editar
                      </button>
                      {member.status !== "DEACTIVATED" ? (
                        <button
                          type="button"
                          className="danger-action"
                          onClick={() => void deactivateMember(member)}
                          disabled={saving}
                        >
                          Desactivar
                        </button>
                      ) : null}
                      {member.status === "INVITED" ? (
                        <button
                          type="button"
                          className="danger-action"
                          onClick={() => void revokeInvitation(member)}
                          disabled={saving}
                        >
                          Revocar invitación
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <aside className="member-card member-form-card">
            {editingMember ? (
              <form onSubmit={(event) => void saveMember(event)}>
                <p className="eyebrow">Editar miembro</p>
                <h2>{editingMember.displayName}</h2>
                <label>
                  Nombre
                  <input
                    value={editDisplayName}
                    onChange={(event) => setEditDisplayName(event.target.value)}
                    required
                    maxLength={160}
                  />
                </label>
                <label>
                  Correo
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    required
                    maxLength={320}
                  />
                </label>
                <label>
                  Alcance de datos
                  <select
                    value={editCommercialScope}
                    onChange={(event) =>
                      setEditCommercialScope(event.target.value as Member["commercialScope"])
                    }
                  >
                    <option value="PROFILE">Todos los registros</option>
                    <option value="TEAM">Registros del equipo</option>
                    <option value="ASSIGNED">Solo asignados</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setEditingMember(null)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="primary-action" disabled={saving}>
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={(event) => void inviteMember(event)}>
                <p className="eyebrow">Nuevo miembro</p>
                <h2>Invitar al equipo</h2>
                <p className="form-intro">
                  Registra una invitación con el rol inicial correspondiente.
                </p>
                <label>
                  Nombre completo
                  <input name="displayName" autoComplete="name" required maxLength={160} />
                </label>
                <label>
                  Correo de trabajo
                  <input name="email" type="email" autoComplete="email" required maxLength={320} />
                </label>
                <label>
                  Rol inicial
                  <select name="roleCode" defaultValue="ADVISOR">
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="primary-action" disabled={saving || !csrfToken}>
                  {saving ? "Registrando…" : "Crear invitación"}
                </button>
              </form>
            )}
          </aside>
        </div>

        <section className="member-card roles-card" aria-labelledby="roles-heading">
          <div className="card-heading">
            <div>
              <h2 id="roles-heading">Roles y permisos</h2>
              <p>Configura una matriz reutilizable para los miembros de este espacio.</p>
            </div>
          </div>
          <div className="roles-layout">
            <ul className="member-list" aria-label="Roles disponibles">
              {roles.map((role) => (
                <li key={role.id} className="member-row">
                  <div className="member-details">
                    <strong>{role.displayName}</strong>
                    <span>
                      {role.system
                        ? "Plantilla del sistema"
                        : `${role.permissions.length} permisos`}
                    </span>
                  </div>
                  {!role.system ? (
                    <button type="button" onClick={() => beginEditingRole(role)} disabled={saving}>
                      Editar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <form onSubmit={(event) => void saveRole(event)}>
              <p className="eyebrow">{editingRole ? "Editar rol" : "Nuevo rol"}</p>
              <label>
                Nombre del rol
                <input
                  value={roleDisplayName}
                  onChange={(event) => setRoleDisplayName(event.target.value)}
                  required
                  maxLength={160}
                />
              </label>
              <fieldset>
                <legend>Permisos</legend>
                {permissionSections.map((section) => (
                  <div key={section} className="permission-section">
                    <strong>{section.replace(":", " / ")}</strong>
                    {CrmPermissionCatalog.filter((permission) =>
                      permission.startsWith(`${section}:`),
                    ).map((permission) => (
                      <label key={permission}>
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(permission)}
                          onChange={(event) =>
                            setRolePermissions((current) =>
                              event.target.checked
                                ? [...current, permission]
                                : current.filter((value) => value !== permission),
                            )
                          }
                        />
                        {permission.split(":").at(-1)}
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
              <div className="form-actions">
                {editingRole ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      setEditingRole(null);
                      setRoleDisplayName("");
                      setRolePermissions([]);
                    }}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                ) : null}
                <button type="submit" className="primary-action" disabled={saving || !csrfToken}>
                  {saving ? "Guardando…" : editingRole ? "Guardar rol" : "Crear rol"}
                </button>
              </div>
            </form>
          </div>
        </section>
        {teamsAvailable ? (
          <section className="member-card roles-card" aria-labelledby="teams-heading">
            <div className="card-heading">
              <div>
                <h2 id="teams-heading">Equipos</h2>
                <p>Organiza miembros para aplicar el alcance de datos por equipo.</p>
              </div>
            </div>
            <form className="inline-form" onSubmit={(event) => void createTeam(event)}>
              <label>
                Nombre del equipo
                <input
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  maxLength={160}
                  required
                />
              </label>
              <button type="submit" className="primary-action" disabled={saving || !csrfToken}>
                Crear equipo
              </button>
            </form>
            {teams.length === 0 ? <p className="state-message">Aún no hay equipos.</p> : null}
            <ul className="member-list" aria-label="Equipos disponibles">
              {teams.map((team) => (
                <li key={team.id} className="member-row">
                  <div className="member-details">
                    <strong>{team.name}</strong>
                    <span>{team.members.length} integrantes</span>
                    {team.members.map((member) => (
                      <small key={member.id}>
                        {member.displayName} · {member.status.toLowerCase()} —{" "}
                        <button
                          type="button"
                          className="text-action"
                          onClick={() => void removeTeamMember(team, member.id)}
                          disabled={saving}
                        >
                          retirar
                        </button>
                      </small>
                    ))}
                  </div>
                  <label>
                    Agregar integrante
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        void addTeamMember(team, event.target.value);
                        event.currentTarget.value = "";
                      }}
                      disabled={saving}
                    >
                      <option value="">Seleccionar…</option>
                      {members
                        .filter(
                          (member) =>
                            member.status === "ACTIVE" &&
                            !team.members.some((teamMember) => teamMember.id === member.id),
                        )
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
