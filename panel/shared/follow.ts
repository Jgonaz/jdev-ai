// Lo que el servidor sirve en GET /api/sessions/:name/follow/:kind/:id y el
// cliente interpreta. Módulo sin dependencias de Node.

import type { Station } from './stations.ts';

export type { Station };

export type FollowKind = 'agent' | 'shell';
export type FollowState = 'running' | 'finished';

/** Un evento de un subagente, ya interpretado por el servidor. */
export type AgentEvent =
  | { type: 'task'; text: string }
  /**
   * `station` es la estación del mapa de actividad, calculada con la entrada completa de la herramienta. Falta en
   * los eventos de servidores antiguos: el cliente la deduce entonces del nombre.
   */
  | { type: 'tool'; id: string; tool: string; verb: string; target: string; detail?: string; at: number | null; station?: Station }
  /**
   * Resultado de una herramienta: se asocia por `id` (puede llegar en otra respuesta). `lines` cuenta las
   * líneas con texto. `output` (solo en la conversación de una sesión) es el texto, recortado, para buscar en él.
   * `at` es la hora de la línea del transcript (para la duración de la llamada); falta en servidores antiguos.
   */
  | { type: 'result'; id: string; error: boolean; summary: string; lines: number; output?: string; at?: number | null }
  | { type: 'message'; text: string; at: number | null }
  /** Mensaje de la persona (solo en la conversación de una sesión). `images` cuenta las imágenes adjuntas, si hay. */
  | { type: 'user'; text: string; at: number | null; images?: number }
  /** Comando de Claude Code (`/goal close`) escrito por la persona (solo en la conversación). `name` va sin la barra. */
  | { type: 'command'; name: string; args: string; at: number | null }
  /** Salida local del último comando (`<local-command-stdout>`), sin secuencias ANSI y recortada. Se empareja por orden. */
  | { type: 'command-output'; text: string; error: boolean; at: number | null }
  /**
   * Tokens de salida de un mensaje del asistente (solo en la conversación de una sesión). Claude Code escribe una línea por
   * bloque de contenido con el mismo `id` y el mismo `usage`: quien suma debe quedarse con el último valor de cada `id`.
   */
  | { type: 'usage'; id: string; output: number; at: number | null };

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

/** Lo que el servidor sirve en GET /api/sessions/:name/conversation: la conversación principal de una sesión de Claude. */
export type ConversationResponse = {
  /** Id de la sesión de Claude a la que pertenece la transcripción: si cambia, el cliente empieza de cero. */
  sessionId: string;
  /** Byte desde el que pedir lo siguiente. */
  from: number;
  /** Tamaño actual de la transcripción en bytes. */
  size: number;
  /** El archivo encogió: se descarta lo que había (y esta respuesta empieza en el byte 0). */
  reset: boolean;
  /** Queda más por leer: se pide enseguida. `false` equivale a «al día». */
  more: boolean;
  events: AgentEvent[];
};

/** Disponibilidad de la vista chat de una sesión. */
export type ChatInfo = { available: boolean; reason: string | null };

/** Ids de subagentes y tareas en segundo plano que se aceptan para seguirlos. */
export const FOLLOW_ID = /^[a-z0-9]{1,64}$/;
