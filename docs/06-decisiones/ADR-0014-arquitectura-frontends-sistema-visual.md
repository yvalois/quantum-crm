# ADR 0014 Arquitectura de frontends y sistema visual

- Estado: aceptado
- Fecha: 2026-09-18
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-020, ADM-01 a ADM-20 y requisitos comerciales con interfaz

## Contexto

Quantum CRM atiende tres audiencias con necesidades y limites de seguridad distintos: el personal de una empresa cliente, los clientes finales de esa empresa y los operadores internos de Quantum. Mezclar estas experiencias en una sola aplicacion haria mas facil reutilizar navegacion o sesiones incorrectas, exponer informacion interna y acoplar despliegues que tienen ciclos diferentes.

El proyecto tambien necesita una referencia visual consultable antes de implementar componentes. El prototipo actual vive en Google Stitch y debe quedar vinculado al repositorio sin presentarlo como codigo terminado ni como fuente de verdad funcional.

## Decision

Se implementan tres aplicaciones Next.js 16 y React independientes dentro del monorepo:

- `crm-web`: espacio de trabajo de asesores, supervisores y administradores de una empresa. Contiene operacion comercial y configuracion del CRM segun permisos.
- `portal-web`: experiencia simple, responsive y white-label para clientes finales. Solo expone recursos propios y acciones expresamente autorizadas por la empresa.
- `admin-web`: control plane exclusivo para operadores de Quantum. Administra tenants, infraestructura, releases, despliegues, respaldos, incidentes y auditoria de plataforma sin consultar datos comerciales.

Las tres aplicaciones:

- se despliegan como artefactos identificables y conservan sesiones, audiencias OIDC y permisos separados;
- usan BFF y contratos publicos; ninguna accede directamente a bases de datos ni contiene reglas de autorizacion como unica barrera;
- pueden reutilizar tokens, primitivas accesibles e infraestructura de pruebas de `packages/ui`, pero no comparten automaticamente navegacion, permisos, layouts ni componentes que revelen capacidades de otra audiencia;
- aplican autorizacion y aislamiento en el servidor, incluidos los recursos consultados desde `portal-web`;
- incluyen estados de carga, vacio, error, degradacion, expiracion de sesion y permiso denegado;
- se prueban con teclado, lectores de pantalla, contraste WCAG AA y breakpoints acordados.

La referencia visual vigente es el proyecto externo **Quantum CRM Enterprise Platform**:

- URL: <https://stitch.withgoogle.com/projects/7483537794480558185?pli=1>
- Catalogo y reglas de uso: [Frontends y referencia visual](../08-arquitectura/frontends-experiencia-visual.md)

Stitch orienta composicion, jerarquia, navegacion y lenguaje visual. No sustituye requisitos, contratos, permisos, accesibilidad, pruebas ni estados reales. Una pantalla generada no demuestra que una funcion este implementada.

## Alternativas consideradas

### Un solo frontend con vistas por rol

Se rechaza porque une sesiones y superficies con niveles de confianza diferentes. Tambien aumenta el riesgo de incluir codigo o datos administrativos en bundles destinados a clientes.

### Dos frontends: CRM y administrador central

Se rechaza porque obligaria a alojar el portal del cliente final dentro del CRM interno o a tratarlo como paginas aisladas sin propietario. `portal-web` necesita navegacion, identidad, responsive, white-label y pruebas propias.

### Usar el prototipo de Stitch como especificacion ejecutable

Se rechaza porque el prototipo puede contener datos ficticios, simplificaciones y controles sin comportamiento. El repositorio y sus requisitos conservan la autoridad.

## Consecuencias

- El arbol objetivo pasa de siete a ocho aplicaciones desplegables.
- `portal-web` se incorpora a contratos, CI, imagenes, configuracion, observabilidad y pruebas E2E.
- `packages/ui` necesita tokens compartidos y variantes por producto sin convertir estilos en permisos.
- Las rutas, componentes y flujos del prototipo deben trazarse a requisitos antes de programarlos.
- Un cambio visual estructural actualiza el catalogo; un cambio de limites, identidad o responsabilidades requiere un ADR sustituto.
- Mantener tres aplicaciones agrega builds y pruebas, a cambio de limites de seguridad y experiencias mas claras.

## Validacion

La decision se valida cuando:

- las ocho aplicaciones del monorepo compilan y producen artefactos identificables;
- cada frontend rechaza una sesion emitida para otra audiencia;
- `portal-web` solo recupera recursos del cliente autenticado y no recibe datos internos del CRM;
- `admin-web` no consulta datos comerciales ni ejecuta shell o Docker directamente;
- los recorridos criticos tienen pruebas responsive, accesibilidad, permisos y estados de fallo;
- cada pantalla implementada referencia requisitos y, cuando corresponda, la pantalla de Stitch usada como insumo;
- una revision visual confirma coherencia sin confundir el prototipo con evidencia funcional.
