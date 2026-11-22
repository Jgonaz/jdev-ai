// Datos de ejemplo de las pestañas Skills y MCPs de la pantalla Proyectos del panel simulado. Nada es real.
// Los proyectos van en el mismo orden que `panel.projects` de los diccionarios; `user` es la entrada «Usuario».
// Cada texto traducible es una pareja [es, en]; `inventory` los resuelve por idioma.

export type Agent = 'claude' | 'codex' | 'copilot' | 'opencode';
// Etiqueta de agente: el icono es el del agente y el texto, su nombre o un origen (claude.ai, plugin…).
export type Tag = { agent: Agent; text: string };
export type Block = { h?: string; p?: string; ol?: string[] };

export type Skill = {
  id: string;
  own: boolean;
  description: string;
  tags: Tag[];
  differs: boolean;
  from: string;
  author?: string;
  body: Block[];
};

export type McpCopy = {
  tag: Tag;
  file: string;
  transport: string;
  command?: string;
  url?: string;
  env: string[];
  headers: string[];
};

export type Mcp = {
  id: string;
  remote: boolean;
  summary: string;
  tags: Tag[];
  differs: boolean;
  // Conector de claude.ai: solo se sabe el nombre, no hay copias que enseñar.
  connector: boolean;
  copies: McpCopy[];
};

export type Inventory = { skills: Skill[]; mcps: Mcp[] };
type Pair = [string, string];

const AGENT_NAME: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', copilot: 'Copilot', opencode: 'OpenCode' };
const tag = (agent: Agent, via?: string): Tag => ({ agent, text: via ?? AGENT_NAME[agent] });

type SkillRaw = {
  id: string;
  own?: boolean;
  description: Pair;
  agents: Tag[];
  differs?: boolean;
  from: string;
  author?: string;
  body: [Block[], Block[]];
};

type CopyRaw = Omit<McpCopy, 'env' | 'headers'> & { env?: string[]; headers?: string[] };
type McpRaw = { id: string; copies: CopyRaw[]; differs?: boolean; connector?: boolean };

const openspecPropose = (agents: Tag[]): SkillRaw => ({
  id: 'openspec-propose',
  description: ['Propone un cambio con su diseño y sus tareas antes de tocar el código.', 'Proposes a change with its design and tasks before touching the code.'],
  agents,
  from: '.claude/skills/openspec-propose',
  author: 'openspec',
  body: [
    [
      { p: 'Crea una carpeta de cambio en openspec/changes/ con la propuesta, el diseño y la lista de tareas.' },
      { h: 'Pasos' },
      { ol: ['Entiende lo que se pide y busca las especificaciones afectadas.', 'Redacta la propuesta y el diseño.', 'Deja las tareas listas para aplicar.'] },
    ],
    [
      { p: 'Creates a change folder in openspec/changes/ with the proposal, the design and the task list.' },
      { h: 'Steps' },
      { ol: ['Understand the request and find the specs it affects.', 'Write the proposal and the design.', 'Leave the tasks ready to apply.'] },
    ],
  ],
});

const openspecApply = (agents: Tag[]): SkillRaw => ({
  id: 'openspec-apply-change',
  description: ['Implementa las tareas de un cambio de OpenSpec, una a una.', 'Implements the tasks of an OpenSpec change, one by one.'],
  agents,
  from: '.claude/skills/openspec-apply-change',
  author: 'openspec',
  body: [
    [
      { p: 'Lee el cambio, aplica cada tarea pendiente y la marca como hecha cuando la validación pasa.' },
      { h: 'Pasos' },
      { ol: ['Elige el cambio activo.', 'Aplica las tareas en orden.', 'Marca cada una y resume lo que queda.'] },
    ],
    [
      { p: 'Reads the change, applies each pending task and ticks it off once validation passes.' },
      { h: 'Steps' },
      { ol: ['Pick the active change.', 'Apply the tasks in order.', 'Tick each one and summarise what is left.'] },
    ],
  ],
});

const releaseNotes = (project: string, agents: Tag[], differs: boolean): SkillRaw => ({
  id: 'release-notes',
  own: true,
  description: ['Redacta las notas de versión a partir de los commits desde la última etiqueta.', 'Writes release notes from the commits since the last tag.'],
  agents,
  differs,
  from: '.claude/skills/release-notes',
  author: project,
  body: [
    [
      { p: 'Agrupa los commits por tipo y escribe notas para quien usa el producto, sin jerga interna.' },
      { h: 'Pasos' },
      { ol: ['Busca la última etiqueta.', 'Lee los commits desde ahí.', 'Redacta las notas y propón el número de versión.'] },
    ],
    [
      { p: 'Groups the commits by type and writes notes for people who use the product, with no internal jargon.' },
      { h: 'Steps' },
      { ol: ['Find the last tag.', 'Read the commits since then.', 'Write the notes and suggest the version number.'] },
    ],
  ],
});

const skillsRaw: SkillRaw[][] = [
  // tienda-web
  [
    releaseNotes('tienda-web', [tag('claude'), tag('codex')], true),
    {
      id: 'a11y-check',
      own: true,
      description: ['Revisa el contraste y las etiquetas de los componentes nuevos.', 'Checks contrast and labels on new components.'],
      agents: [tag('claude')],
      from: '.claude/skills/a11y-check',
      author: 'tienda-web',
      body: [
        [{ p: 'Recorre los componentes cambiados y señala los que no cumplen el contraste mínimo o no tienen nombre accesible.' }],
        [{ p: 'Walks through the changed components and flags those below the minimum contrast or without an accessible name.' }],
      ],
    },
    openspecPropose([tag('claude'), tag('codex'), tag('copilot'), tag('opencode')]),
    openspecApply([tag('claude'), tag('codex')]),
  ],
  // api-pedidos: solo de terceros
  [openspecPropose([tag('claude'), tag('opencode')]), openspecApply([tag('claude')])],
  // docs: sin skills
  [],
];

const userSkillsRaw: SkillRaw[] = [
  {
    id: 'daily-notes',
    own: true,
    description: ['Resume el día en una nota con lo hecho, lo pendiente y los bloqueos.', 'Sums up the day in a note with what is done, pending and blocked.'],
    agents: [tag('claude', 'claude.ai')],
    from: '~/.claude/skills/daily-notes',
    author: 'usuario',
    body: [
      [{ p: 'Pregunta qué se ha hecho hoy y lo ordena en tres apartados: hecho, pendiente y bloqueos.' }],
      [{ p: 'Asks what was done today and sorts it into three sections: done, pending and blocked.' }],
    ],
  },
  {
    id: 'pdf',
    description: ['Lee, combina y rellena archivos PDF.', 'Reads, merges and fills in PDF files.'],
    agents: [tag('claude', 'claude.ai')],
    from: '~/.claude/skills/pdf',
    body: [
      [{ p: 'Extrae texto y tablas, une o separa páginas y rellena formularios.' }],
      [{ p: 'Extracts text and tables, merges or splits pages and fills in forms.' }],
    ],
  },
  {
    id: 'docx',
    description: ['Crea y edita documentos de Word.', 'Creates and edits Word documents.'],
    agents: [tag('claude', 'claude.ai')],
    from: '~/.claude/skills/docx',
    body: [
      [{ p: 'Genera documentos .docx con estilos, tablas e imágenes, y edita los existentes.' }],
      [{ p: 'Builds .docx documents with styles, tables and images, and edits existing ones.' }],
    ],
  },
  {
    id: 'deploy',
    description: ['Despliega el proyecto actual y comprueba el resultado.', 'Deploys the current project and checks the result.'],
    agents: [tag('claude', 'plugin deploy-kit')],
    from: '~/.claude/plugins/deploy-kit/skills/deploy',
    author: 'deploy-kit',
    body: [
      [{ p: 'Lanza el despliegue de la vista previa o de producción y abre la dirección resultante.' }],
      [{ p: 'Launches the preview or production deployment and opens the resulting address.' }],
    ],
  },
];

const mcpsRaw: McpRaw[][] = [
  // tienda-web
  [
    {
      id: 'playwright',
      copies: [
        { tag: tag('claude'), file: '.mcp.json', transport: 'stdio', command: 'npx @playwright/mcp@0.0.83' },
        { tag: tag('codex'), file: '.codex/config.toml', transport: 'stdio', command: 'npx @playwright/mcp@0.0.83' },
      ],
    },
    {
      id: 'postgres',
      copies: [
        {
          tag: tag('claude'),
          file: '.mcp.json',
          transport: 'stdio',
          command: 'npx -y @modelcontextprotocol/server-postgres',
          env: ['DATABASE_URL'],
        },
      ],
    },
    {
      id: 'github',
      copies: [
        { tag: tag('claude'), file: '.mcp.json', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: ['Authorization'] },
        { tag: tag('copilot'), file: '.vscode/mcp.json', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: ['Authorization'] },
      ],
    },
  ],
  // api-pedidos
  [
    {
      id: 'postgres',
      differs: true,
      copies: [
        {
          tag: tag('claude'),
          file: '.mcp.json',
          transport: 'stdio',
          command: 'npx -y @modelcontextprotocol/server-postgres',
          env: ['DATABASE_URL'],
        },
        {
          tag: tag('codex'),
          file: '.codex/config.toml',
          transport: 'stdio',
          command: 'npx @modelcontextprotocol/server-postgres',
          env: ['DATABASE_URL', 'PGSSLMODE'],
        },
      ],
    },
    { id: 'sentry', copies: [{ tag: tag('claude'), file: '.mcp.json', transport: 'http', url: 'https://mcp.sentry.dev/mcp' }] },
  ],
  // docs: sin MCPs
  [],
];

const userMcpsRaw: McpRaw[] = [
  { id: 'fetch', copies: [{ tag: tag('claude'), file: '~/.claude.json', transport: 'stdio', command: 'uvx mcp-server-fetch' }] },
  { id: 'Google Drive', connector: true, copies: [] },
  {
    id: 'vercel',
    copies: [
      { tag: tag('codex'), file: '~/.codex/config.toml', transport: 'http', url: 'https://mcp.vercel.com' },
      { tag: tag('claude', 'plugin vercel'), file: '.mcp.json (plugin vercel)', transport: 'http', url: 'https://mcp.vercel.com' },
    ],
  },
];

const buildSkill = (s: SkillRaw, i: 0 | 1): Skill => ({
  id: s.id,
  own: !!s.own,
  description: s.description[i],
  tags: s.agents,
  differs: !!s.differs,
  from: s.from,
  author: s.author,
  body: s.body[i],
});

const buildMcp = (m: McpRaw): Mcp => {
  const first = m.copies[0];
  return {
    id: m.id,
    remote: !!m.connector || !!first?.url,
    summary: first ? (first.url ?? first.command ?? '') : '',
    // Una etiqueta por copia (agente u origen); un conector de claude.ai no tiene copias.
    tags: m.connector ? [tag('claude', 'claude.ai')] : m.copies.map((c) => c.tag),
    differs: !!m.differs,
    connector: !!m.connector,
    copies: m.copies.map((c) => ({ ...c, env: c.env ?? [], headers: c.headers ?? [] })),
  };
};

const build = (i: 0 | 1) => ({
  projects: skillsRaw.map((skills, p) => ({ skills: skills.map((s) => buildSkill(s, i)), mcps: mcpsRaw[p].map(buildMcp) })),
  user: { skills: userSkillsRaw.map((s) => buildSkill(s, i)), mcps: userMcpsRaw.map(buildMcp) },
});

// Los textos de los MCP (comandos, URL, archivos) no se traducen: los dos idiomas comparten datos.
export const inventory: Record<'es' | 'en', { projects: Inventory[]; user: Inventory }> = { es: build(0), en: build(1) };
