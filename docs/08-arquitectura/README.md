# Arquitectura de referencia

Esta carpeta describe la arquitectura vigente derivada de los ADR aceptados. No reemplaza las decisiones: muestra como encajan y sirve como mapa para implementar sin reinterpretarlas.

## Documentos

1. [Mapa del sistema](mapa-del-sistema.md): actores, aplicaciones, procesos, datos y flujos principales.
2. [Especificacion del monorepo](monorepo.md): estructura objetivo, responsabilidades, dependencias y comandos comunes.
3. [Agentes LangGraph y MCP](agentes-mcp.md): runtime agentivo, subagentes, contexto, tools, memoria, seguridad y evaluacion.
4. [Archivos y objetos](archivos-objetos.md): almacenamiento S3 en el VPS, cuarentena, acceso, retencion y recuperacion.
5. [Frontends y referencia visual](frontends-experiencia-visual.md): audiencias, limites, inventario de pantallas y enlace al proyecto de Stitch.
6. [Respaldo, restauracion y continuidad](respaldo-restauracion-continuidad.md): recovery points coordinados, RPO/RTO, cifrado, aislamiento y simulacros.

## Autoridad

- Los ADR en `../06-decisiones/` explican y gobiernan las decisiones.
- Este mapa debe actualizarse cuando un ADR aceptado cambie componentes, limites o dependencias.
- La implementacion debe coincidir con este documento o registrar claramente la diferencia antes de cerrarse.
- Los nombres aqui definidos son objetivos de implementacion; su presencia en el documento no acredita que el codigo exista.

## Estado

La arquitectura esta especificada, pero el monorepo de aplicacion todavia no ha sido creado. El estado comprobable vive en `../04-proceso/estado.md`.
