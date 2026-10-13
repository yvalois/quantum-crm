"use client";

import {
  CrmPermissionCatalog,
  type CrmPermission,
  type Member,
  type Role,
  type Team,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { CrmShell } from "./crm-shell";

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
    readonly temporaryPassword: string;
    readonly expiresAt: string;
  };
}

const permissionSections = Array.from(
  new Set(CrmPermissionCatalog.map((permission) => permission.split(":").slice(0, 2).join(":"))),
);

function memberStatus(status: Member["status"]): string {
  return { ACTIVE: "Activo", DEACTIVATED: "Desactivado", INVITED: "Invitado" }[status];
}

function scopeLabel(scope: Member["commercialScope"]): string {
  return { PROFILE: "Todo el espacio", TEAM: "Su equipo", ASSIGNED: "Solo asignados" }[scope];
}

const permissionAreaLabels: Record<string, string> = {
  "iam:members": "Usuarios",
  "iam:teams": "Equipos",
  "crm:contacts": "Contactos",
  "crm:sales": "Ventas",
  "crm:tasks": "Tareas",
  "crm:calendar": "Calendario",
  "crm:forms": "Formularios",
  "crm:automations": "Automatizaciones",
  "crm:conversations": "Conversaciones",
  "crm:documents": "Documentos",
  "crm:files": "Archivos",
};

const permissionActionLabels: Record<string, string> = {
  read: "Ver",
  create: "Crear",
  update: "Editar",
  delete: "Eliminar",
  deactivate: "Desactivar",
  export: "Exportar",
  roles: "Gestionar roles",
  assign: "Asignar",
  configure: "Configurar",
  move: "Mover",
  write: "Escribir",
  publish: "Publicar",
  responses: "Ver respuestas",
  execute: "Ejecutar",
  reply: "Responder",
  "control-agent": "Controlar agente",
  templates: "Plantillas",
  upload: "Subir",
  reference: "Vincular",
  download: "Descargar",
};

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
  const [activeView, setActiveView] = useState<"members" | "roles" | "teams">("members");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<"ALL" | Member["status"]>("ALL");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRoleCode, setInviteRoleCode] = useState("ADVISOR");
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const memberDialogRef = useRef<HTMLDialogElement>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRoleCode, setEditRoleCode] = useState("ADVISOR");
  const [editCommercialScope, setEditCommercialScope] =
    useState<Member["commercialScope"]>("ASSIGNED");
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleDisplayName, setRoleDisplayName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<CrmPermission[]>([]);
  const invitationKey = useRef<string | null>(null);

  useEffect(() => {
    const dialog = memberDialogRef.current;
    if (!dialog) return;
    if (showInvite || editingMember) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [showInvite, editingMember]);

  const closeMemberDialog = (): void => {
    if (saving) return;
    setShowInvite(false);
    setEditingMember(null);
  };

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
      setShowRoleEditor(false);
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
    setShowRoleEditor(true);
    setActiveView("roles");
    setError(null);
    setNotice(null);
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!csrfToken) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      formElement.reset();
      setInviteRoleCode("ADVISOR");
      invitationKey.current = null;
      setShowInvite(false);
      setActivationLink(payload.activation);
      setNotice(
        payload.activation
          ? "Usuario creado. Copia ahora la contraseña temporal: no volverá a mostrarse."
          : "La invitación ya existía; no se generó otra contraseña temporal.",
      );
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
    const roleChanged = editRoleCode !== (editingMember.roleCode ?? "ADVISOR");
    const profileChanged =
      editDisplayName !== editingMember.displayName || editEmail !== editingMember.email;
    if (!scopeChanged && !roleChanged && !profileChanged) {
      setEditingMember(null);
      return;
    }
    if (scopeChanged && (profileChanged || roleChanged)) {
      setError("Guarda el alcance separado de los datos y el rol.");
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
            : {
                ...(editDisplayName !== editingMember.displayName
                  ? { displayName: editDisplayName }
                  : {}),
                ...(editEmail !== editingMember.email ? { email: editEmail } : {}),
                ...(roleChanged ? { roleCode: editRoleCode } : {}),
              },
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
    setShowInvite(false);
    setEditingMember(member);
    setEditDisplayName(member.displayName);
    setEditEmail(member.email);
    setEditRoleCode(member.roleCode ?? "ADVISOR");
    setEditCommercialScope(member.commercialScope);
    setError(null);
    setNotice(null);
  };

  const visibleMembers = members.filter((member) => {
    if (memberFilter !== "ALL" && member.status !== memberFilter) return false;
    const query = memberQuery.trim().toLocaleLowerCase("es");
    return (
      query.length === 0 ||
      member.displayName.toLocaleLowerCase("es").includes(query) ||
      member.email.toLocaleLowerCase("es").includes(query)
    );
  });
  const activeCount = members.filter((member) => member.status === "ACTIVE").length;
  const invitedCount = members.filter((member) => member.status === "INVITED").length;

  return (
    <CrmShell>
      <section className="crm-content team-workspace" aria-busy={loading}>
        <div className="team-topline">
          <span>
            ADMINISTRACIÓN <span aria-hidden="true">/</span> EQUIPO Y ACCESO
          </span>
          <div className="team-topline-actions">
            <button
              type="button"
              className="team-refresh"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Actualizar
            </button>
            <button
              type="button"
              className="team-new-member"
              onClick={() => {
                setEditingMember(null);
                setShowInvite(true);
              }}
              disabled={!csrfToken}
            >
              <span aria-hidden="true">+</span> Nuevo usuario
            </button>
          </div>
        </div>
        <header className="team-hero">
          <div>
            <p className="team-kicker">PERSONAS · ACCESOS · EQUIPOS</p>
            <h1>Tu equipo, en orden.</h1>
            <p>Personas y permisos de este CRM, sin mezclar los accesos de otros perfiles.</p>
          </div>
          <div className="team-hero-figure" aria-hidden="true">
            <span>{String(members.length).padStart(2, "0")}</span>
            <small>PERSONAS</small>
          </div>
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
          <section className="feedback feedback-success" role="status">
            <strong>Acceso temporal listo</strong>
            <p>
              Contraseña temporal: <code>{activationLink.temporaryPassword}</code>
            </p>
            <button
              type="button"
              className="secondary-action"
              onClick={() => void navigator.clipboard.writeText(activationLink.temporaryPassword)}
            >
              Copiar contraseña
            </button>{" "}
            <a href={activationLink.url} target="_blank" rel="noreferrer">
              Abrir configuración directa
            </a>
            <p>
              En el primer acceso se exigirá cambiar la contraseña y configurar TOTP. Vigente hasta{" "}
              {dateLabel(activationLink.expiresAt)}.
            </p>
          </section>
        ) : null}

        <div className="team-metrics" aria-label="Resumen del equipo">
          <div>
            <span>Total</span>
            <strong>{members.length}</strong>
            <small>en este espacio</small>
          </div>
          <div>
            <span>Activos</span>
            <strong>{activeCount}</strong>
            <small>con acceso vigente</small>
          </div>
          <div>
            <span>Invitados</span>
            <strong>{invitedCount}</strong>
            <small>por activar</small>
          </div>
        </div>
        <nav className="team-tabs" aria-label="Secciones del equipo">
          <button
            type="button"
            aria-pressed={activeView === "members"}
            onClick={() => setActiveView("members")}
          >
            Usuarios <span>{members.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={activeView === "roles"}
            onClick={() => setActiveView("roles")}
          >
            Roles y permisos <span>{roles.length}</span>
          </button>
          {teamsAvailable ? (
            <button
              type="button"
              aria-pressed={activeView === "teams"}
              onClick={() => setActiveView("teams")}
            >
              Equipos <span>{teams.length}</span>
            </button>
          ) : null}
        </nav>
        {activeView === "members" ? (
          <div className="member-layout team-member-layout">
            <section className="member-card team-directory" aria-labelledby="members-heading">
              <div className="card-heading team-directory-heading">
                <div>
                  <p className="team-section-label">DIRECTORIO</p>
                  <h2 id="members-heading">Personas del CRM</h2>
                  <p>Consulta el estado de cada acceso y administra sus datos.</p>
                </div>
              </div>
              <div className="team-directory-toolbar">
                <label className="team-search">
                  <span className="visually-hidden">Buscar usuario</span>
                  <input
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="Buscar por nombre o correo"
                    type="search"
                  />
                </label>
                <label className="team-status-filter">
                  <span className="visually-hidden">Filtrar por estado</span>
                  <select
                    value={memberFilter}
                    onChange={(event) => setMemberFilter(event.target.value as typeof memberFilter)}
                  >
                    <option value="ALL">Todos los estados</option>
                    <option value="ACTIVE">Activos</option>
                    <option value="INVITED">Invitados</option>
                    <option value="DEACTIVATED">Desactivados</option>
                  </select>
                </label>
              </div>
              {loading ? <p className="state-message">Cargando equipo…</p> : null}
              {!loading && members.length === 0 ? (
                <p className="state-message">Aún no hay miembros registrados.</p>
              ) : null}
              {!loading && members.length > 0 && visibleMembers.length === 0 ? (
                <p className="state-message">No hay usuarios que coincidan con la búsqueda.</p>
              ) : null}
              {!loading && visibleMembers.length > 0 ? (
                <ul className="member-list">
                  {visibleMembers.map((member) => (
                    <li key={member.id} className="member-row team-person-row">
                      <div className="member-avatar" aria-hidden="true">
                        {member.displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="member-details">
                        <strong>{member.displayName}</strong>
                        <span>{member.email}</span>
                        <small>
                          Desde {dateLabel(member.createdAt)} <span aria-hidden="true">·</span>{" "}
                          {scopeLabel(member.commercialScope)}
                          {member.roleCode
                            ? ` · ${roles.find((role) => role.code === member.roleCode)?.displayName ?? member.roleCode}`
                            : ""}
                        </small>
                      </div>
                      <span className={`status status-${member.status.toLowerCase()}`}>
                        {memberStatus(member.status)}
                      </span>
                      <div className="member-actions team-person-actions">
                        <button
                          type="button"
                          onClick={() => beginEditing(member)}
                          disabled={saving}
                        >
                          Editar
                        </button>
                        {member.status !== "DEACTIVATED" ? (
                          <details className="team-action-menu">
                            <summary aria-label={`Más acciones para ${member.displayName}`}>
                              ···
                            </summary>
                            <div>
                              {member.status === "INVITED" ? (
                                <button
                                  type="button"
                                  onClick={() => void revokeInvitation(member)}
                                  disabled={saving}
                                >
                                  Revocar invitación
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void deactivateMember(member)}
                                disabled={saving}
                              >
                                Desactivar acceso
                              </button>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        ) : null}

        <dialog
          ref={memberDialogRef}
          className="team-dialog"
          aria-label={editingMember ? `Editar a ${editingMember.displayName}` : "Crear usuario"}
          onClose={closeMemberDialog}
          onCancel={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <div className="team-dialog-topline">
            <span>{editingMember ? "PERFIL DE USUARIO" : "INVITACIÓN SEGURA"}</span>
            <button type="button" onClick={closeMemberDialog} disabled={saving} aria-label="Cerrar">
              ×
            </button>
          </div>
          <aside className="member-card member-form-card team-member-form">
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
                  Rol
                  <select
                    value={editRoleCode}
                    onChange={(event) => setEditRoleCode(event.target.value)}
                  >
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Alcance de datos
                  <select
                    value={editCommercialScope}
                    disabled={editRoleCode === "ADVISOR"}
                    onChange={(event) =>
                      setEditCommercialScope(event.target.value as Member["commercialScope"])
                    }
                  >
                    <option value="PROFILE">Todos los registros</option>
                    <option value="TEAM">Registros del equipo</option>
                    <option value="ASSIGNED">Solo asignados</option>
                  </select>
                  {editRoleCode === "ADVISOR" ? (
                    <small>Los asesores solo pueden acceder a registros asignados.</small>
                  ) : null}
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
                <h2>Crear usuario</h2>
                <p className="form-intro">
                  El acceso será temporal. En su primer ingreso, la persona cambiará la contraseña y
                  configurará TOTP.
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
                  <select
                    name="roleCode"
                    value={inviteRoleCode}
                    onChange={(event) => setInviteRoleCode(event.target.value)}
                  >
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="primary-action" disabled={saving || !csrfToken}>
                  {saving ? "Creando…" : "Crear usuario y acceso"}
                </button>
              </form>
            )}
          </aside>
        </dialog>

        {activeView === "roles" ? (
          <section className="member-card roles-card team-roles" aria-labelledby="roles-heading">
            <div className="card-heading team-section-heading">
              <div>
                <p className="team-section-label">CONTROL DE ACCESO</p>
                <h2 id="roles-heading">Roles y permisos</h2>
                <p>Define qué puede hacer cada persona. Las plantillas del sistema no se editan.</p>
              </div>
              <button
                type="button"
                className="team-new-member"
                onClick={() => {
                  setEditingRole(null);
                  setRoleDisplayName("");
                  setRolePermissions([]);
                  setShowRoleEditor(true);
                }}
              >
                + Nuevo rol
              </button>
            </div>
            <div className="roles-layout">
              <ul className="member-list" aria-label="Roles disponibles">
                {roles.map((role) => (
                  <li key={role.id} className="member-row team-role-row">
                    <div className="member-details">
                      <strong>{role.displayName}</strong>
                      <span>
                        {role.system
                          ? "Plantilla del sistema"
                          : `${role.permissions.length} permisos configurados`}
                      </span>
                    </div>
                    {!role.system ? (
                      <button
                        type="button"
                        onClick={() => beginEditingRole(role)}
                        disabled={saving}
                      >
                        Editar
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {showRoleEditor ? (
                <form className="team-role-editor" onSubmit={(event) => void saveRole(event)}>
                  <p className="eyebrow">{editingRole ? "Editar rol" : "Nuevo rol"}</p>
                  <h3>{editingRole ? editingRole.displayName : "Configurar nuevo rol"}</h3>
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
                        <strong>
                          {permissionAreaLabels[section] ?? section.replace(":", " / ")}
                        </strong>
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
                            {permissionActionLabels[permission.split(":").at(-1) ?? ""] ??
                              permission.split(":").at(-1)}
                          </label>
                        ))}
                      </div>
                    ))}
                  </fieldset>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        setShowRoleEditor(false);
                        setEditingRole(null);
                        setRoleDisplayName("");
                        setRolePermissions([]);
                      }}
                      disabled={saving}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="primary-action"
                      disabled={saving || !csrfToken}
                    >
                      {saving ? "Guardando…" : editingRole ? "Guardar rol" : "Crear rol"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="team-role-empty">
                  <strong>Permisos bajo control</strong>
                  <p>
                    Elige un rol personalizado para editarlo o crea uno nuevo. Las plantillas del
                    sistema permanecen protegidas.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : null}
        {activeView === "teams" && teamsAvailable ? (
          <section className="member-card roles-card team-teams" aria-labelledby="teams-heading">
            <div className="card-heading team-section-heading">
              <div>
                <p className="team-section-label">ORGANIZACIÓN</p>
                <h2 id="teams-heading">Equipos</h2>
                <p>Agrupa a las personas para coordinar su trabajo y alcance de datos.</p>
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
    </CrmShell>
  );
}
