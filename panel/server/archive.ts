import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './paths.ts';
import { SESSION_ID } from './recent.ts';
import { isPanelSessionName } from './tmux.ts';

// Lo que la persona ha archivado en la barra lateral: sesiones del panel y
// conversaciones de «Anteriores». Archivar solo aparta (no termina ni borra
// nada), así que es una lista pequeña en la configuración del panel.

/** Máximo de entradas de cada lista; al pasarse, se descartan las más antiguas. */
export const ARCHIVE_MAX = 500;

/** Una sesión de tmux se identifica por nombre y fecha de creación: el nombre se reutiliza. */
export type ArchivedSession = { name: string; created: number };

export type ArchiveList = {
  sessions: ArchivedSession[];
  /** Ids de sesión de Claude, de la más antigua a la más reciente. */
  conversations: string[];
};

export function archivePath(dir: string = configDir()): string {
  return join(dir, 'archived.json');
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lista leída con cuidado: lo que no es válido se descarta, sin duplicados y con el límite aplicado. */
export function parseArchive(crudo: unknown): ArchiveList {
  const sessions: ArchivedSession[] = [];
  const conversations: string[] = [];
  if (esObjeto(crudo)) {
    if (Array.isArray(crudo.sessions)) {
      for (const e of crudo.sessions) {
        if (!esObjeto(e) || typeof e.name !== 'string' || typeof e.created !== 'number') continue;
        if (!isPanelSessionName(e.name) || !Number.isFinite(e.created)) continue;
        if (sessions.some((s) => s.name === e.name && s.created === e.created)) continue;
        sessions.push({ name: e.name, created: e.created });
      }
    }
    if (Array.isArray(crudo.conversations)) {
      for (const id of crudo.conversations) {
        if (typeof id === 'string' && SESSION_ID.test(id) && !conversations.includes(id)) conversations.push(id);
      }
    }
  }
  return { sessions: sessions.slice(-ARCHIVE_MAX), conversations: conversations.slice(-ARCHIVE_MAX) };
}

export function readArchive(dir: string = configDir()): ArchiveList {
  try {
    return parseArchive(JSON.parse(readFileSync(archivePath(dir), 'utf8')));
  } catch {
    return { sessions: [], conversations: [] };
  }
}

// Escritura atómica: archivo temporal en el mismo directorio y rename (como panel.json).
export function writeArchive(lista: ArchiveList, dir: string = configDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destino = archivePath(dir);
  const temporal = `${destino}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(lista, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temporal, 0o600);
  renameSync(temporal, destino);
}

/**
 * Lista de archivadas en memoria, respaldada por archived.json. Se lee una vez al
 * arrancar (el panel es quien la escribe) y cada cambio se guarda al momento,
 * para que sobreviva a los reinicios sin leer el disco en cada refresco de sesiones.
 */
export class ArchiveStore {
  private readonly dir: string;
  private list: ArchiveList;

  constructor(dir: string = configDir()) {
    this.dir = dir;
    this.list = readArchive(dir);
  }

  snapshot(): ArchiveList {
    return { sessions: [...this.list.sessions], conversations: [...this.list.conversations] };
  }

  hasSession(name: string, created: number): boolean {
    return this.list.sessions.some((s) => s.name === name && s.created === created);
  }

  hasConversation(id: string): boolean {
    return this.list.conversations.includes(id);
  }

  /** Archiva o desarchiva una sesión; al desarchivar basta el nombre. Devuelve si cambió algo. */
  setSession(name: string, created: number, archived: boolean): boolean {
    const resto = this.list.sessions.filter((s) => s.name !== name);
    let sessions: ArchivedSession[];
    if (archived) {
      if (this.hasSession(name, created)) return false;
      sessions = [...resto, { name, created }].slice(-ARCHIVE_MAX);
    } else {
      if (resto.length === this.list.sessions.length) return false;
      sessions = resto;
    }
    this.commit({ ...this.list, sessions });
    return true;
  }

  /** Archiva o desarchiva una conversación. Devuelve si cambió algo. */
  setConversation(id: string, archived: boolean): boolean {
    if (archived === this.hasConversation(id)) return false;
    const conversations = archived
      ? [...this.list.conversations, id].slice(-ARCHIVE_MAX)
      : this.list.conversations.filter((c) => c !== id);
    this.commit({ ...this.list, conversations });
    return true;
  }

  /**
   * Quita las sesiones archivadas que ya no están en tmux (o cuyo nombre se
   * reutilizó para otra). Solo se llama con una lista de tmux leída con éxito.
   * Es una limpieza: si no se puede guardar, no falla y se reintenta con el siguiente cambio.
   */
  pruneSessions(vivas: readonly { name: string; created: number }[]): boolean {
    const sessions = this.list.sessions.filter((a) => vivas.some((s) => s.name === a.name && s.created === a.created));
    if (sessions.length === this.list.sessions.length) return false;
    try {
      this.commit({ ...this.list, sessions });
    } catch (e) {
      console.error('No se pudo guardar archived.json:', e instanceof Error ? e.message : e);
      this.list = { ...this.list, sessions };
    }
    return true;
  }

  /** Guarda y solo entonces adopta la lista: si no se puede escribir, lanza y no cambia nada. */
  private commit(siguiente: ArchiveList): void {
    writeArchive(siguiente, this.dir);
    this.list = siguiente;
  }
}
