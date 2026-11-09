// Contrato de GET /api/activity, compartido por el servidor (que lo calcula) y
// el cliente (que lo pinta). Sin dependencias de Node.

export const ACTIVITY_RANGES = ['week', '30d', 'all'] as const;
export const ACTIVITY_AGENTS = ['all', 'claude', 'codex'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];
export type ActivityAgent = (typeof ACTIVITY_AGENTS)[number];

/** Semanas que cubre el calendario de respuestas por día. */
export const CALENDAR_WEEKS = 12;

/** Cifras de un periodo. Los tokens de entrada no incluyen la caché. */
export type ActivityTotals = {
  responses: number;
  output: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Conversaciones principales con alguna respuesta en el periodo. */
  sessions: number;
  /** Tiempo con actividad, en segundos (los solapes entre sesiones se cuentan una vez). */
  activeSeconds: number;
  /** Días con alguna respuesta. */
  activeDays: number;
};

export type ActivityDay = { date: string; responses: number };

/** Familias de modelo con color propio; «other» es todo lo demás. */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'codex' | 'other';

export type ActivityModel = {
  family: ModelFamily;
  /** Nombre que se muestra: el de la versión más usada de la familia («Opus 5.5»). */
  label: string;
  responses: number;
  /** Desglose por versión, de más a menos respuestas (solo si hay más de una). */
  versions: { label: string; responses: number }[];
};

export type ActivityProject = {
  /** null: «Otros» (proyectos fuera del panel y los que no caben en el top). */
  id: string | null;
  name: string;
  mono: string | null;
  color: string | null;
  output: number;
};

export type ActivityCount = { name: string; count: number };

export type ActivityResponse = {
  range: ActivityRange;
  agent: ActivityAgent;
  /** Hay trabajo de indexado en marcha: las cifras pueden estar incompletas. */
  indexing: boolean;
  /** Avance de la pasada en curso, en bytes; null si no hay pasada. */
  progress: { done: number; total: number } | null;
  /** Fin de la última pasada completa, en ms desde la época; null si aún no hubo ninguna. */
  updatedAt: number | null;
  /** Primer y último día del periodo (AAAA-MM-DD, hora local). */
  period: { from: string; to: string; days: number };
  totals: ActivityTotals;
  /** Periodo anterior equivalente; null en «todo». */
  previous: ActivityTotals | null;
  sessionsByAgent: { claude: number; codex: number };
  /** 12 semanas completas de lunes a domingo, la última la de hoy. */
  days: ActivityDay[];
  /** Hoy y los días siguientes de la última semana aún no han ocurrido. */
  today: string;
  streak: number;
  bestDay: ActivityDay | null;
  byProject: ActivityProject[];
  byModel: ActivityModel[];
  agents: ActivityCount[];
  tools: ActivityCount[];
};

/** Etiqueta legible de un modelo a partir de su id («claude-opus-5-5» → «Opus 5.5»). */
export function modelLabel(model: string): string {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (m) {
    const nombre = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
    return m[3] ? `${nombre} ${m[2]}.${m[3]}` : `${nombre} ${m[2]}`;
  }
  const f = /(opus|sonnet|haiku)/.exec(model.toLowerCase());
  if (f) return f[1]!.charAt(0).toUpperCase() + f[1]!.slice(1);
  return model.length > 40 ? `${model.slice(0, 39)}…` : model;
}
