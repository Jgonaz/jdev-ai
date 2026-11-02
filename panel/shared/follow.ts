// Lo que el servidor sirve en GET /api/sessions/:name/follow/:kind/:id y el
// cliente interpreta. Módulo sin dependencias de Node.

export type FollowKind = 'agent' | 'shell';
export type FollowState = 'running' | 'finished';

/** Un evento de un subagente, ya interpretado por el servidor. */
export type AgentEvent =
  | { type: 'task'; text: string }
  | { type: 'tool'; id: string; tool: string; verb: string; target: string; detail?: string; at: number | null }
  /** Resultado de una herramienta: se asocia por `id` (puede llegar en otra respuesta). `lines` cuenta las líneas con texto. */
  | { type: 'result'; id: string; error: boolean; summary: string; lines: number }
  | { type: 'message'; text: string; at: number | null };

type Common = {
  state: FollowState;
  /** Byte desde el que pedir lo siguiente. */
  from: number;
  /** El archivo encogió o cambió: se descarta lo que había. */
  reset: boolean;
  /** Queda más por leer: se pide enseguida. */
  more: boolean;
};

export type AgentFollow = Common & {
  kind: 'agent';
  meta: { description: string | null; agentType: string; startedAt: number | null; updatedAt: number | null };
  events: AgentEvent[];
};

export type ShellFollow = Common & {
  kind: 'shell';
  meta: { command: string; startedAt: number | null; updatedAt: number | null };
  text: string;
};

export type FollowResponse = AgentFollow | ShellFollow;

/** Ids de subagentes y tareas en segundo plano que se aceptan para seguirlos. */
export const FOLLOW_ID = /^[a-z0-9]{1,64}$/;
