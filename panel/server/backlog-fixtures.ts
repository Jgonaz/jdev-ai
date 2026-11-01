// Elementos de backlog de ejemplo para las pruebas.

export const itemSource = (id: string, status: string, extra = '') => `---
id: ${id}
title: "Título con comillas" # comentario del título
type: feature
status: '${status}' # estado
priority: alta
created: 2026-10-24
updated: 2026-10-25
${extra}refs:
  - "\`a.ts\`"
---

# Título con comillas

## Resumen

Primer párrafo
en dos líneas.

Segundo párrafo.

## Contexto

Más detalle.
`;

export const LEGACY = `# Título antiguo

- ID: \`BL-20260101-0000-viejo\`
- Tipo: fix
- Estado: pendiente
- **Prioridad:** alta
- Creado: 2026-01-01

## Resumen

Resumen viejo.

## Detalle

- Tipo: esto no es metadato
`;
