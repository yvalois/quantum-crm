# OPS-23-a - Acceso operativo seguro al VPS

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-23`
- Requisitos relacionados: `OPS-02`, `OPS-03`, `OPS-04`, `OPS-10`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: acceso `root` por clave ya verificado y huella del host registrada
- Bloquea a: operaciones repetibles en el VPS sin autenticacion SSH por contrasena
- ADR, arquitectura o diseno aplicables: ADR-0008, ADR-0009 y `docs/05-reglas/03-seguridad-y-datos.md`

## Resultado esperado

Existe un usuario operativo nominal autenticado solo por una clave dedicada, el acceso SSH por contrasena queda deshabilitado y se conserva temporalmente una ruta `root` por clave para recuperacion hasta comprobar el acceso de consola del proveedor.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: inventario del VPS, configuracion efectiva de OpenSSH, usuarios, grupos, firewall, actualizaciones y herramientas de backup.
- Codigo o documentacion encontrados: acceso actual como `root`; clave dedicada instalada; `PasswordAuthentication yes`, `PermitRootLogin yes`, `X11Forwarding yes`; no existe usuario operativo.
- Pruebas e historial encontrados: acceso por clave y huella ED25519 verificados durante `OPS-02`; Nginx y los sitios existentes permanecen activos.
- Decision de reutilizacion, extension o reemplazo: conservar la clave `root` actual solo como fallback temporal y crear una identidad operativa separada con otra clave.

## Alcance

### Incluido

- Crear `quantum-ops` con contrasena bloqueada y home propio.
- Instalar una clave ED25519 dedicada fuera del repositorio.
- Conceder `sudo` no interactivo temporal para el bootstrap, registrando que equivale a privilegio administrativo.
- Deshabilitar autenticacion SSH por contrasena e interaccion de teclado.
- Limitar `root` a clave publica mientras no este comprobada la recuperacion desde el panel de Hostinger.
- Deshabilitar X11, reducir intentos y tiempo de gracia y validar configuracion y conexiones nuevas antes de cerrar la sesion existente.

### No incluido

- Deshabilitar por completo `root` antes de verificar recuperacion fuera de SSH.
- Activar UFW o cambiar el firewall de Hostinger.
- Cambiar Nginx, Certbot, Docker, 80/443 o los sitios existentes.
- Tratar el `sudo` temporal como el modelo final de `deploy-executor`.

## Impacto tecnico

| Area                       | Impacto previsto                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | Ninguno                                                                                      |
| Contratos y eventos        | Ninguno                                                                                      |
| Datos y migraciones        | Ninguno                                                                                      |
| Permisos y aislamiento     | Usuario nominal; SSH solo por clave; privilegio administrativo temporal auditado por usuario |
| Configuracion y secretos   | Clave privada solo en el perfil local; ningun secreto en Git o en argumentos remotos         |
| Observabilidad y operacion | Login y `sudo` quedan atribuibles a `quantum-ops`; fallback root permanece por clave         |
| Documentacion              | Inventario, estado y evidencia de esta ficha                                                 |

## Plan de implementacion

- [x] Generar una clave local dedicada y restringir sus ACL.
- [x] Crear el usuario bloqueado, instalar su clave publica y validar permisos.
- [x] Validar una conexion nueva y `sudo -n` antes de endurecer OpenSSH.
- [x] Instalar un drop-in SSH validado con `sshd -t` y recargar sin cerrar conexiones.
- [x] Revalidar usuario operativo y fallback `root` por clave tras la recarga.
- [x] Cambiar el alias principal al usuario operativo y conservar un alias explicito de recuperacion.
- [x] Registrar evidencia sin valores secretos.

## Riesgos y mitigaciones

| Riesgo                   | Mitigacion                                                                                      | Verificacion                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bloqueo remoto           | Mantener sesion actual y root por clave hasta validar dos conexiones nuevas                     | SSH batch como usuario operativo y root despues de recargar |
| Clave privada expuesta   | Guardarla fuera del repositorio con ACL del usuario local                                       | Ruta, permisos y fingerprint; nunca contenido               |
| Privilegio excesivo      | Declarar `sudo` completo como bootstrap temporal y retirarlo al implementar operaciones tipadas | `sudo -n id`; pendiente explicito de reduccion              |
| Romper sitios existentes | No modificar Nginx, Docker, firewall ni 80/443                                                  | Nginx activo y comprobacion HTTP posterior                  |

## Criterios de aceptacion

- [x] `quantum-ops` entra por su clave y no tiene contrasena utilizable.
- [x] `sudo -n` funciona para el bootstrap y su alcance temporal esta documentado.
- [x] La configuracion efectiva muestra contrasena e interaccion de teclado deshabilitadas, `root` solo por clave y X11 deshabilitado.
- [x] El alias normal usa `quantum-ops`; el fallback root es explicito y funciona por clave.
- [x] Nginx y los hosts existentes permanecen activos.

## Plan de verificacion

- Pruebas unitarias: no aplica.
- Pruebas de integracion o contratos: conexion SSH independiente con ambas identidades.
- Pruebas E2E: login de `quantum-ops`, `sudo -n id`, lectura del estado de Nginx.
- Comprobacion manual: `sshd -T`, estado de usuario, permisos de `.ssh` y escucha de puertos.
- Seguridad, permisos y aislamiento: no imprimir claves; cuenta bloqueada; autenticacion solo por clave.
- Idempotencia, concurrencia y recuperacion: comandos condicionados por existencia; drop-in nuevo removible; fallback root preservado.
- Comandos que deben aprobar: `sshd -t`, SSH BatchMode de ambas identidades, `sudo -n true`, `systemctl is-active nginx`.

## Recuperacion

- Compatibilidad o migracion: no afecta aplicaciones ni datos.
- Rollback de aplicacion: eliminar el drop-in nuevo y recargar SSH desde una sesion ya abierta; el archivo original no se modifica.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: rama `chore/OPS-23-vps-access`; `/etc/ssh/sshd_config.d/10-quantum-access.conf`, `/etc/sudoers.d/quantum-ops` y alias locales fuera de Git.
- Identidad: `quantum-ops` tiene home propio, shell Bash, contrasena bloqueada, `.ssh` `0700` y `authorized_keys` `0600`.
- Clave: ED25519 dedicada con fingerprint `SHA256:4/JzJ66lWKFIokZ6z8d8NMwWiy9sV3YdT+cK+nPKvGg`; la privada no se imprimio ni entro en el repositorio.
- Configuracion efectiva: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`, `X11Forwarding no`, `MaxAuthTries 3`, `LoginGraceTime 30` y allowlist `quantum-ops root`.
- Comandos y resultados: `sshd -t`, acceso BatchMode de ambas identidades, `sudo -n id` y Nginx aprobaron; el intento sin clave y solo con password fue rechazado con codigo 255.
- Documentacion actualizada: inventario del VPS, despliegues, estado y esta ficha.
- Desviaciones del plan: el primer nombre `60-quantum-access.conf` quedaba despues de `50-cloud-init.conf` y no anulaba `PasswordAuthentication yes`; se detecto con `sshd -T`, se reemplazo por `10-quantum-access.conf` y se volvio a validar sin perder acceso.
- Pendientes o decisiones nuevas: comprobar consola de Hostinger, resetear o bloquear la contrasena root expuesta, retirar el fallback root y sustituir privilegio administrativo humano por operaciones tipadas.
