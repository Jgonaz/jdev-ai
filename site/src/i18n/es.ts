// Textos de la landing en castellano. Las cadenas con `<code>` se pintan como HTML.
export const es = {
  meta: {
    title: 'jdev-ai · Harness para trabajar con agentes de código',
    description:
      'Harness ligero y agnóstico del stack: reglas y flujos compartidos para trabajar con agentes de código en varios proyectos independientes.',
  },
  nav: {
    label: 'Secciones',
    what: 'Qué es',
    features: 'Funcionalidades',
    panel: 'Panel',
    flow: 'Flujo',
    start: 'Empezar',
    language: 'Idioma',
  },
  hero: {
    eyebrow: 'Harness open source · Licencia MIT',
    title: ['Unas reglas.', 'Varios agentes.', 'Todos tus proyectos.'],
    lead: 'jdev-ai es un harness ligero y agnóstico del stack: reglas y flujos compartidos para trabajar con agentes de código en varios proyectos independientes, sin copiarlos en cada repositorio ni depender de la CLI de un proveedor.',
    start: 'Empezar',
    github: 'Ver en GitHub',
    worksWith: 'Funciona con',
  },
  mock: {
    label:
      'Maqueta ilustrativa del panel gráfico de jdev-ai: sesiones agrupadas por proyecto y una terminal con un agente',
    tabs: ['Inicio', 'Terminales', 'Proyectos', 'Historial'],
    projects: ['mi-proyecto', 'otra-app'],
    sessions: [
      { title: 'Login con passkeys', state: 'Esperándote' },
      { title: 'Migración de estilos', state: 'Trabajando' },
      { title: 'Exportar informes a PDF', state: 'Inactiva' },
      { title: 'Corrección del carrito', state: 'Hecha' },
    ],
    view: 'Terminal / Chat',
    lines: [
      'Implementa el login con passkeys',
      'Es un cambio grande: propongo OpenSpec y un worktree «login». ¿Empiezo?',
      'Adelante',
      'Delego en implementer: formulario y registro de credenciales',
      'Delego en validator: validaciones del proyecto',
      '✓ sin fallos',
      'Listo para integrar. ¿Abro la Pull Request?',
    ],
  },
  what: {
    eyebrow: '// qué es',
    title: 'Las mismas preguntas, respondidas una sola vez',
    lead: '¿Cuándo delega el agente? ¿Cómo retomas un proyecto tras una semana? ¿Cuándo merece un cambio una spec? ¿Cómo evitan pisarse varias sesiones en paralelo? Las respuestas viven en el harness, no repetidas en cada repositorio.',
    cards: [
      {
        title: 'El harness define cómo trabajan los agentes',
        text: 'Cada repositorio de <code>projects/</code> define su dominio, su código, sus dependencias y sus validaciones.',
      },
      {
        title: 'No es un monorepo ni un workspace',
        text: 'Cada proyecto conserva su propio <code>.git</code> y sigue funcionando si el harness desaparece.',
      },
      {
        title: 'No impone stack ni arquitectura',
        text: 'Ni gestor de paquetes. El <code>AGENTS.md</code> de cada proyecto prevalece sobre las instrucciones globales.',
      },
    ],
  },
  features: {
    eyebrow: '// funcionalidades',
    title: 'Todo el ciclo, con tu aprobación en cada paso que importa',
    cards: [
      {
        title: 'Lanzador multiagente',
        text: '<code>bin/agent</code> abre un proyecto con Claude Code, Codex, Copilot u OpenCode y te resume dónde lo dejaste. No añade archivos de configuración a tus proyectos.',
      },
      {
        title: 'Orquestación y delegación',
        text: 'El agente principal orquesta y delega trabajo acotado en subagentes. La política no depende del proveedor.',
      },
      {
        title: 'Economía de contexto y tokens',
        text: 'El orquestador conserva la conversación y las decisiones; modelos más baratos leen e implementan, y devuelven solo conclusiones.',
      },
      {
        title: 'Continuidad del proyecto',
        text: 'Un historial local de iteraciones y una memoria opcional por proyecto permiten retomar el trabajo días después.',
      },
      {
        title: 'Worktrees por feature',
        text: 'Los cambios grandes se aíslan en un worktree con su rama. Varias sesiones trabajan en un mismo proyecto sin pisarse.',
      },
      {
        title: 'OpenSpec opcional',
        text: 'El agente valora si un cambio merece una spec y la propone. No crea ningún artefacto sin tu aprobación explícita.',
      },
      {
        title: 'Diseño primero',
        text: 'Ante cambios de interfaz no triviales, propone cerrar antes el diseño, que pasa a ser la referencia de la implementación y del QA.',
      },
      {
        title: 'Cierre autónomo',
        text: '<code>/goal Close</code> hace que el agente trabaje sin preguntar hasta validar, integrar y limpiar. Sigue preguntando antes de acciones destructivas.',
      },
      {
        title: 'Backlog, guías e imágenes',
        text: 'El trabajo futuro se registra solo tras tu confirmación, las guías didácticas viven en el proyecto y las imágenes que faltan se proponen antes de generarse.',
      },
    ],
  },
  subagents: {
    title: 'Cada subagente, un papel acotado',
    columns: ['Subagente', 'Modelo', 'Papel'],
    rows: [
      { name: 'Explore', model: 'Haiku', role: 'Búsqueda y lectura del repositorio, en solo lectura' },
      { name: 'implementer', model: 'Sonnet', role: 'El único que puede escribir; un encargo acotado cada vez' },
      {
        name: 'validator',
        model: 'Haiku',
        role: 'Ejecuta las validaciones del proyecto e informa solo de los fallos y su causa',
      },
      {
        name: 'qa',
        model: 'Sonnet',
        role: 'QA de punta a punta en el navegador con Playwright, antes de cerrar una feature',
      },
    ],
    note: 'Roles definidos para Claude Code. Si una herramienta no tiene subagentes compatibles, el agente principal hace los papeles en secuencia.',
  },
  panel: {
    eyebrow: '// panel gráfico',
    title: 'Todas tus sesiones, en una sola ventana',
    lead: '<code>bin/panel</code> sirve un panel web local que reúne las terminales de agente de todos tus proyectos y te dice cuál te está esperando.',
    cards: [
      {
        title: 'Inicio',
        text: 'Lo que necesita tu atención: sesiones que te esperan, conversaciones hechas, pendientes de cada proyecto y tu actividad.',
      },
      {
        title: 'Terminales que sobreviven',
        text: 'Viven en un servidor tmux dedicado: cierras el navegador y siguen ahí. En una, dos o cuatro columnas.',
      },
      {
        title: 'Vista de chat',
        text: 'La misma sesión como conversación: tus mensajes, las respuestas en Markdown y las herramientas agrupadas, con búsqueda.',
      },
      {
        title: 'Backlog',
        text: 'Un tablero por estado con el backlog de cada proyecto y un atajo «Trabajar en esto» que abre una sesión nueva.',
      },
      {
        title: 'Cambios',
        text: 'El diff del checkout principal y de cada worktree, con árbol de archivos y vista en paralelo o unificada.',
      },
      {
        title: 'Historial',
        text: 'Las iteraciones de todos los proyectos por día, con sus pendientes y un atajo «Retomar desde aquí».',
      },
    ],
    note: 'Local y privado: se sirve en 127.0.0.1 protegido con token, y se puede instalar como aplicación (PWA).',
  },
  flow: {
    eyebrow: '// flujo habitual',
    title: 'De la petición al merge, sin perder el control',
    // `approval` marca los pasos que esperan el visto bueno de la persona.
    steps: [
      {
        title: 'Petición',
        text: 'Cuentas lo que quieres y el orquestador lee el AGENTS.md del proyecto.',
        approval: false,
      },
      {
        title: 'Propuesta',
        text: 'Si el cambio es grande, propone OpenSpec, worktree o diseño y espera tu aprobación.',
        approval: true,
      },
      {
        title: 'Plan y exploración',
        text: 'Explore busca y lee el repositorio en solo lectura.',
        approval: false,
      },
      { title: 'Implementación', text: 'implementer ejecuta un encargo acotado cada vez.', approval: false },
      {
        title: 'Validación',
        text: 'validator ejecuta las validaciones que define el proyecto.',
        approval: false,
      },
      {
        title: 'QA y revisión',
        text: 'Si hay interfaz, QA con Playwright tras tu OK. Después, revisión final del orquestador.',
        approval: true,
      },
      {
        title: 'Publicación',
        text: 'Commit, push, Pull Request y merge, solo tras tu confirmación.',
        approval: true,
      },
      { title: 'Historial', text: 'La iteración queda registrada para retomarla otro día.', approval: false },
    ],
    note: 'En ámbar, los pasos que esperan tu visto bueno. La delegación se omite en tareas triviales.',
  },
  start: {
    eyebrow: '// empezar',
    title: 'Clona, añade un proyecto y lanza un agente',
    lead: 'Necesitas una shell POSIX, Git y la CLI del agente que quieras usar. Añade <code>gh</code> para el flujo de Pull Requests de los worktrees.',
    note: 'Las reglas están escritas en castellano y los agentes responden en castellano por defecto, salvo que el proyecto diga otra cosa.',
    repo: 'Ver el repositorio',
    docs: 'Leer la documentación',
    docsUrl: 'https://github.com/Jgonaz/jdev-ai#readme',
    terminal: 'terminal',
    comments: [
      '# 1. Clona el harness y añade un proyecto con su .git',
      '# 2. Lanza un agente (Claude Code por defecto)',
      '# 3. O abre el panel gráfico',
    ],
    repoPlaceholder: '<url-de-tu-repo>',
    project: 'mi-proyecto',
  },
  footer: {
    by: 'Hecho por',
    role: ', desarrollador front-end sénior centrado en el desarrollo con agentes.',
    license: 'Licencia MIT',
  },
};

export type Dictionary = typeof es;
