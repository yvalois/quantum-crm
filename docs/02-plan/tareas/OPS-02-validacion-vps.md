# OPS-02 - Validar el VPS antes de instalar

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificacion

- Requisito principal: `OPS-02`
- Requisitos relacionados: `OPS-01`, `OPS-03`, `OPS-04`, `OPS-05`, `OPS-21`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: acceso al VPS entregado por el propietario
- ADR y arquitectura aplicables: ADR-0008, ADR-0009, ADR-0010, ADR-0015 y `docs/03-operaciones/despliegues.md`

## Resultado esperado

Inventariar el VPS real, establecer acceso SSH reutilizable sin guardar contraseñas, detectar servicios que deben preservarse y medir la capacidad necesaria antes de instalar o publicar Quantum CRM.

## Alcance

### Incluido

- Verificar identidad SSH y registrar una clave dedicada fuera del repositorio.
- Inventariar sistema, CPU, RAM, disco, Docker, redes, puertos y servicios existentes.
- Detectar conflictos con 80/443 y proteger sitios existentes.
- Ejecutar builds y smoke de contenedores solo de forma aislada y secuencial.
- Registrar riesgos y datos faltantes sin guardar secretos.

### No incluido

- Interrumpir Nginx, los sitios existentes, SSH o el agente del proveedor.
- Publicar Quantum en Internet o dirigir trafico real.
- Rotar credenciales, cambiar firewall o sustituir el proxy sin un plan probado.
- Marcar `OPS-02` terminado mientras falten proveedor, firewall, capacidad medida y respaldo externo.

## Plan

- [x] Recuperar los datos del VPS previamente entregados y corregir el falso bloqueo documental.
- [x] Crear y verificar una clave SSH dedicada sin persistir la contraseña.
- [x] Inventariar sistema, recursos, Docker, puertos y servicios.
- [x] Registrar Nginx y los sitios existentes como recursos a preservar.
- [ ] Construir imagenes de referencia secuencialmente en el VPS.
- [ ] Ejecutar smoke aislado en puertos loopback sin usar 80/443.
- [ ] Medir consumo y documentar limites iniciales.
- [ ] Resolver proveedor, firewall y respaldo externo antes del cierre.

## Evidencia

- Inventario: [`inventario-vps.md`](../../03-operaciones/inventario-vps.md).
- Acceso: alias local `quantum-crm-vps` con autenticacion por clave verificada.
- Pendiente: builds, smoke y medicion real de contenedores.
