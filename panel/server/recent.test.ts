import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from './projects.ts';
import {
  MESSAGE_PROBE_BYTES,
  POSSIBLY_OPEN_MS,
  RECENT_MAX_AGE_MS,
  RECENT_MAX_ARCHIVED_PER_PROJECT,
  RECENT_MAX_PER_PROJECT,
  RecentIndex,
  projectSlug,
} from './recent.ts';

const AHORA = Date.UTC(2026, 10, 1, 12, 0, 0);
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const linea = (obj: unknown) => JSON.stringify(obj) + '\n';
const mensajes = linea({ type: 'user', message: { content: 'hola' } }) + linea({ type: 'assistant', message: { content: 'qué tal' } });
const custom = (t: string) => linea({ type: 'custom-title', customTitle: t, sessionId: 's' });
const ai = (t: string) => linea({ type: 'ai-title', aiTitle: t, sessionId: 's' });

function proyecto(id: string, path: string, worktrees: { name: string; path: string }[] = []): Project {
  return {
    id,
    name: id,
    path,
    harness: false,
    branch: 'main',
    worktrees: worktrees.map((w) => ({ ...w, branch: `feat/${w.name}` })),
    mono: 'XX',
    color: '#000000',
    visible: true,
    defaultMono: 'XX',
    defaultColor: '#000000',
    runCommand: null,
    runSource: null,
    runDetected: null,
  };
}

describe('projectSlug', () => {
  it('sustituye por «-» cada carácter que no sea [A-Za-z0-9]', () => {
    expect(projectSlug('/home/jgonazdev/proyectos/jdev-ai/projects/balanz.io')).toBe(
      '-home-jgonazdev-proyectos-jdev-ai-projects-balanz-io',
    );
    expect(projectSlug('/home/jgonazdev/proyectos/jdev-ai/projects/fitnessia.worktrees/routine-templates')).toBe(
      '-home-jgonazdev-proyectos-jdev-ai-projects-fitnessia-worktrees-routine-templates',
    );
    expect(projectSlug('/home/jgonazdev/proyectos/jdev-ai')).toBe('-home-jgonazdev-proyectos-jdev-ai');
    expect(projectSlug('/a/ñ b_c')).toBe('-a---b-c');
  });
});

describe('RecentIndex', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'jdev-recent-'));
  const raiz = '/h/projects';
  const balanz = proyecto('balanz.io', `${raiz}/balanz.io`, [{ name: 'feat-x', path: `${raiz}/balanz.io.worktrees/feat-x` }]);
  const fit = proyecto('fitnessia', `${raiz}/fitnessia`);
  let casos = 0;
  let projectsDir = '';
  let idx: RecentIndex;

  beforeEach(() => {
    projectsDir = join(tmp, `caso${casos++}`, 'projects');
    mkdirSync(projectsDir, { recursive: true });
    idx = new RecentIndex({ projectsDir, now: () => AHORA });
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  // Crea un transcript con mtime = AHORA - hace.
  function transcript(p: Project, worktree: string, id: string, contenido: string, hace = 10 * MIN): string {
    const ruta = worktree ? p.worktrees.find((w) => w.name === worktree)!.path : p.path;
    const dir = join(projectsDir, projectSlug(ruta));
    mkdirSync(dir, { recursive: true });
    const archivo = join(dir, `${id}.jsonl`);
    writeFileSync(archivo, contenido);
    const t = new Date(AHORA - hace);
    utimesSync(archivo, t, t);
    return archivo;
  }

  it('lista las sesiones del checkout principal y de los worktrees, de la más reciente a la más antigua', async () => {
    transcript(balanz, '', uuid(1), mensajes + custom('Arreglar login'), 60 * MIN);
    transcript(balanz, 'feat-x', uuid(2), mensajes + custom('[Closed] Migración'), 30 * MIN);
    transcript(fit, '', uuid(3), mensajes + ai('Título generado'), 5 * DIA);
    const r = await idx.list([balanz, fit]);
    expect(r.map((s) => [s.id, s.project, s.worktree, s.title, s.done])).toEqual([
      [uuid(2), 'balanz.io', 'feat-x', 'Migración', { at: null, by: 'agent', note: null }],
      [uuid(1), 'balanz.io', '', 'Arreglar login', null],
      [uuid(3), 'fitnessia', '', 'Título generado', null],
    ]);
    expect(r[0]).toMatchObject({ lastActivity: AHORA - 30 * MIN, possiblyOpen: false });
    expect(r[0]!.sizeBytes).toBeGreaterThan(0);
  });

  it('el título propio manda sobre el generado, y el último de cada tipo vale', async () => {
    transcript(balanz, '', uuid(1), mensajes + ai('IA 1') + custom('Propio 1') + ai('IA 2') + custom('Propio 2') + ai('IA 3'));
    transcript(balanz, '', uuid(2), mensajes + ai('IA 1') + ai('IA 2'));
    transcript(balanz, '', uuid(3), mensajes, 20 * MIN);
    const r = await idx.list([balanz]);
    expect(r.find((s) => s.id === uuid(1))!.title).toBe('Propio 2');
    expect(r.find((s) => s.id === uuid(2))!.title).toBe('IA 2');
    // Sin ningún título: un nombre reconocible con el comienzo del id.
    expect(r.find((s) => s.id === uuid(3))!.title).toBe('Sin título · 00000003');
  });

  it('marca como posiblemente abiertas las que tienen actividad en los últimos 3 minutos', async () => {
    transcript(balanz, '', uuid(1), mensajes, POSSIBLY_OPEN_MS - 1000);
    transcript(balanz, '', uuid(2), mensajes, POSSIBLY_OPEN_MS + 1000);
    const r = await idx.list([balanz]);
    expect(r.map((s) => [s.id, s.possiblyOpen])).toEqual([
      [uuid(1), true],
      [uuid(2), false],
    ]);
  });

  it('excluye las sesiones que ya están en el panel', async () => {
    transcript(balanz, '', uuid(1), mensajes);
    transcript(balanz, '', uuid(2), mensajes);
    const r = await idx.list([balanz], new Set([uuid(1)]));
    expect(r.map((s) => s.id)).toEqual([uuid(2)]);
  });

  it('excluye transcripts vacíos o sin mensajes de usuario ni de asistente', async () => {
    transcript(balanz, '', uuid(1), '');
    transcript(balanz, '', uuid(2), linea({ type: 'file-history-snapshot' }) + custom('Solo título'));
    transcript(balanz, '', uuid(3), linea({ type: 'permission-mode' }) + linea({ type: 'user', message: { content: 'x' } }));
    // Archivo grande sin mensajes en la parte examinada: se da por no vacío.
    transcript(balanz, '', uuid(4), linea({ type: 'file-history-snapshot', pad: 'x'.repeat(MESSAGE_PROBE_BYTES) }));
    const r = await idx.list([balanz]);
    expect(r.map((s) => s.id).sort()).toEqual([uuid(3), uuid(4)]);
  });

  it('ignora lo que no es un transcript directo: subcarpetas, otros nombres y otras extensiones', async () => {
    transcript(balanz, '', uuid(1), mensajes);
    const dir = join(projectsDir, projectSlug(balanz.path));
    mkdirSync(join(dir, uuid(9)), { recursive: true });
    writeFileSync(join(dir, uuid(9), `${uuid(8)}.jsonl`), mensajes);
    mkdirSync(join(dir, `${uuid(7)}.jsonl`));
    writeFileSync(join(dir, 'agent-abc.jsonl'), mensajes);
    writeFileSync(join(dir, `${uuid(6)}.txt`), mensajes);
    expect((await idx.list([balanz])).map((s) => s.id)).toEqual([uuid(1)]);
  });

  it('descarta las anteriores a 30 días y limita a 15 por proyecto (checkout y worktrees juntos)', async () => {
    transcript(balanz, '', uuid(100), mensajes, RECENT_MAX_AGE_MS + MIN);
    transcript(balanz, '', uuid(101), mensajes, RECENT_MAX_AGE_MS - MIN);
    for (let i = 1; i <= 12; i++) transcript(balanz, '', uuid(i), mensajes, i * MIN);
    for (let i = 21; i <= 25; i++) transcript(balanz, 'feat-x', uuid(i), mensajes, (i - 20) * MIN + 30_000);
    transcript(fit, '', uuid(50), mensajes, 40 * DIA - MIN);
    const r = await idx.list([balanz, fit]);
    const b = r.filter((s) => s.project === 'balanz.io');
    expect(b).toHaveLength(RECENT_MAX_PER_PROJECT);
    expect(b.some((s) => s.id === uuid(100))).toBe(false);
    // Las 15 más recientes: la más antigua de las 17 candidatas válidas queda fuera.
    expect(b.some((s) => s.id === uuid(101))).toBe(false);
    expect(b.some((s) => s.id === uuid(12))).toBe(false);
    expect(r.some((s) => s.project === 'fitnessia')).toBe(false);
    expect(r.map((s) => s.lastActivity)).toEqual([...r.map((s) => s.lastActivity)].sort((a, b2) => b2 - a));
  });

  it('el límite se aplica tras excluir las del panel y las vacías', async () => {
    for (let i = 1; i <= 18; i++) transcript(balanz, '', uuid(i), i === 1 ? '' : mensajes, i * MIN);
    const r = await idx.list([balanz], new Set([uuid(2)]));
    expect(r).toHaveLength(RECENT_MAX_PER_PROJECT);
    expect(r.map((s) => s.id)).not.toContain(uuid(1));
    expect(r.map((s) => s.id)).not.toContain(uuid(2));
    expect(r.at(-1)!.id).toBe(uuid(17));
  });

  it('las archivadas no gastan la cuota de las demás: archivar deja aparecer las siguientes', async () => {
    for (let i = 1; i <= 20; i++) transcript(balanz, '', uuid(i), mensajes, i * MIN);
    const sin = await idx.list([balanz]);
    expect(sin.map((s) => s.id)).toEqual(Array.from({ length: RECENT_MAX_PER_PROJECT }, (_, i) => uuid(i + 1)));
    // Se archivan las tres más recientes: salen de la cuota y entran las tres siguientes.
    const archivadas = [uuid(1), uuid(2), uuid(3)];
    const r = await idx.list([balanz], new Set(), archivadas);
    const ids = r.map((s) => s.id);
    expect(ids).toEqual(Array.from({ length: RECENT_MAX_PER_PROJECT + 3 }, (_, i) => uuid(i + 1)));
    expect(ids).toContain(uuid(18));
    expect(ids).not.toContain(uuid(19));
  });

  it('las archivadas tienen su propio máximo y solo se ven dentro de los 30 días', async () => {
    const n = RECENT_MAX_ARCHIVED_PER_PROJECT + 2;
    for (let i = 1; i <= n; i++) transcript(balanz, '', uuid(i), mensajes, i * MIN);
    transcript(balanz, '', uuid(90), mensajes, 31 * DIA);
    const archivadas = [...Array.from({ length: n }, (_, i) => uuid(i + 1)), uuid(90)];
    const r = await idx.list([balanz], new Set(), archivadas);
    expect(r).toHaveLength(RECENT_MAX_ARCHIVED_PER_PROJECT);
    expect(r.map((s) => s.id)).not.toContain(uuid(90));
    // Las del panel siguen excluidas aunque estén archivadas.
    expect((await idx.list([balanz], new Set([uuid(1)]), [uuid(1)])).map((s) => s.id)).not.toContain(uuid(1));
  });

  it('ignora los transcripts de worktrees que ya no existen y de proyectos desconocidos', async () => {
    transcript(balanz, 'feat-x', uuid(1), mensajes);
    transcript(fit, '', uuid(2), mensajes);
    const sinWorktree = proyecto('balanz.io', `${raiz}/balanz.io`);
    expect(await idx.list([sinWorktree])).toEqual([]);
    expect((await idx.list([sinWorktree, fit])).map((s) => s.id)).toEqual([uuid(2)]);
    // Sin carpeta de transcripts para el proyecto: lista vacía, sin error.
    expect(await new RecentIndex({ projectsDir: join(tmp, 'no-existe') }).list([balanz])).toEqual([]);
  });

  it('relee un transcript cuando cambia (caché por mtime y tamaño)', async () => {
    const ruta = transcript(balanz, '', uuid(1), mensajes + custom('Uno'));
    expect((await idx.list([balanz]))[0]!.title).toBe('Uno');
    writeFileSync(ruta, mensajes + custom('Uno') + custom('[Closed] Dos'));
    const t = new Date(AHORA - 2 * MIN);
    utimesSync(ruta, t, t);
    const r = await idx.list([balanz]);
    expect(r[0]).toMatchObject({ title: 'Dos', done: { at: null, by: 'agent', note: null }, possiblyOpen: true });
    // Una sesión vacía que recibe mensajes pasa a listarse.
    const vacia = transcript(balanz, '', uuid(2), '', 20 * MIN);
    expect((await idx.list([balanz])).map((s) => s.id)).not.toContain(uuid(2));
    writeFileSync(vacia, mensajes);
    const t2 = new Date(AHORA - 19 * MIN);
    utimesSync(vacia, t2, t2);
    expect((await idx.list([balanz])).map((s) => s.id)).toContain(uuid(2));
  });

  it('locate encuentra el proyecto y el worktree de una sesión, sin los límites de la lista', async () => {
    transcript(balanz, 'feat-x', uuid(1), mensajes, 90 * DIA);
    transcript(fit, '', uuid(2), '');
    expect(await idx.locate([balanz, fit], uuid(1))).toEqual({ project: 'balanz.io', worktree: 'feat-x' });
    expect(await idx.locate([balanz, fit], uuid(2))).toEqual({ project: 'fitnessia', worktree: '' });
    expect(await idx.locate([balanz, fit], uuid(3))).toBeNull();
    expect(await idx.locate([balanz, fit], '../../etc/passwd')).toBeNull();
  });

  it('transcriptPath da la ruta del transcript o null', async () => {
    const ruta = transcript(balanz, 'feat-x', uuid(1), mensajes, 90 * DIA);
    expect(await idx.transcriptPath([balanz, fit], uuid(1))).toBe(ruta);
    expect(await idx.transcriptPath([balanz, fit], uuid(3))).toBeNull();
    expect(await idx.transcriptPath([balanz, fit], '../../etc/passwd')).toBeNull();
  });

  it('doneOf decide si la conversación está hecha a partir de su id y de la marca antigua', async () => {
    transcript(balanz, '', uuid(1), mensajes + custom('[Closed] Con marca'), 10 * MIN);
    transcript(balanz, '', uuid(2), mensajes + custom('Sin marca'), 20 * MIN);
    const hecha = { at: '2026-11-01T10:00:00.000Z', by: 'user', note: 'Revisada' } as const;
    const propio = new RecentIndex({
      projectsDir,
      now: () => AHORA,
      // El estado propio manda: reabierta aunque el título lleve la marca, y hecha aunque no.
      doneOf: (id) => (id === uuid(2) ? hecha : null),
    });
    const r = await propio.list([balanz]);
    expect(r.map((s) => [s.id, s.title, s.done])).toEqual([
      [uuid(1), 'Con marca', null],
      [uuid(2), 'Sin marca', hecha],
    ]);
  });
});
