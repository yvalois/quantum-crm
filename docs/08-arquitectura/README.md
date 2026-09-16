# Arquitectura de referencia

Esta carpeta describe la arquitectura vigente derivada de los ADR aceptados. No reemplaza las decisiones: muestra como encajan y sirve como mapa para implementar sin reinterpretarlas.

## Documentos

1. [Mapa del sistema](mapa-del-sistema.md): actores, aplicaciones, procesos, datos y flujos principales.
2. [Especificacion del monorepo](monorepo.md): estructura objetivo, responsabilidades, dependencias y comandos comunes.

## Autoridad

- Los ADR en `../06-decisiones/` explican y gobiernan las decisiones.
- Este mapa debe actualizarse cuando un ADR aceptado cambie componentes, limites o dependencias.
- La implementacion debe coincidir con este documento o registrar claramente la diferencia antes de cerrarse.
- Los nombres aqui definidos son objetivos de implementacion; su presencia en el documento no acredita que el codigo exista.

## Estado

La arquitectura esta especificada, pero el monorepo de aplicacion todavia no ha sido creado. El estado comprobable vive en `../04-proceso/estado.md`.
