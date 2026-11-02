import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARCHIVE_MAX, ArchiveStore, archivePath, parseArchive, readArchive } from './archive.ts';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jdev-archive-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseArchive', () => {
  it('descarta lo no válido, los duplicados y lo que no es un objeto', () => {
    expect(parseArchive(null)).toEqual({ sessions: [], conversations: [] });
    expect(parseArchive([1])).toEqual({ sessions: [], conversations: [] });
    const r = parseArchive({
      sessions: [
        { name: 'jdev-foo-1', created: 10 },
        { name: 'jdev-foo-1', created: 10 },
        { name: 'otra', created: 10 },
        { name: 'jdev-foo-2', created: 'x' },
        { name: 'jdev-foo-3', created: Infinity },
        null,
        { name: 'jdev-foo-4', created: 5 },
      ],
      conversations: [uuid(1), uuid(1), 'no-es-uuid', 3, uuid(2)],
    });
    expect(r).toEqual({
      sessions: [
        { name: 'jdev-foo-1', created: 10 },
        { name: 'jdev-foo-4', created: 5 },
      ],
      conversations: [uuid(1), uuid(2)],
    });
  });

  it('conserva las ARCHIVE_MAX más recientes de cada lista', () => {
    const r = parseArchive({ conversations: Array.from({ length: ARCHIVE_MAX + 3 }, (_, i) => uuid(i)) });
    expect(r.conversations).toHaveLength(ARCHIVE_MAX);
    expect(r.conversations[0]).toBe(uuid(3));
    expect(r.conversations.at(-1)).toBe(uuid(ARCHIVE_MAX + 2));
  });
});

describe('ArchiveStore', () => {
  it('empieza vacío sin archivo, y con un archivo ilegible', () => {
    expect(new ArchiveStore(dir).snapshot()).toEqual({ sessions: [], conversations: [] });
    writeFileSync(archivePath(dir), '{no es json');
    expect(readArchive(dir)).toEqual({ sessions: [], conversations: [] });
    expect(new ArchiveStore(dir).snapshot()).toEqual({ sessions: [], conversations: [] });
  });

  it('archiva y desarchiva sesiones; la clave es nombre y creación', () => {
    const a = new ArchiveStore(dir);
    expect(a.setSession('jdev-foo-1', 100, true)).toBe(true);
    expect(a.setSession('jdev-foo-1', 100, true)).toBe(false);
    expect(a.hasSession('jdev-foo-1', 100)).toBe(true);
    // El nombre se reutilizó para otra sesión: no es la archivada.
    expect(a.hasSession('jdev-foo-1', 200)).toBe(false);
    expect(a.setSession('jdev-foo-1', 0, false)).toBe(true);
    expect(a.setSession('jdev-foo-1', 0, false)).toBe(false);
    expect(a.snapshot().sessions).toEqual([]);
  });

  it('archiva y desarchiva conversaciones sin duplicar', () => {
    const a = new ArchiveStore(dir);
    expect(a.setConversation(uuid(1), true)).toBe(true);
    expect(a.setConversation(uuid(1), true)).toBe(false);
    expect(a.setConversation(uuid(2), true)).toBe(true);
    expect(a.snapshot().conversations).toEqual([uuid(1), uuid(2)]);
    expect(a.setConversation(uuid(1), false)).toBe(true);
    expect(a.setConversation(uuid(1), false)).toBe(false);
    expect(a.snapshot().conversations).toEqual([uuid(2)]);
  });

  it('al pasar del límite descarta las más antiguas', () => {
    const a = new ArchiveStore(dir);
    for (let i = 0; i < ARCHIVE_MAX + 2; i++) a.setConversation(uuid(i), true);
    const lista = a.snapshot().conversations;
    expect(lista).toHaveLength(ARCHIVE_MAX);
    expect(a.hasConversation(uuid(0))).toBe(false);
    expect(a.hasConversation(uuid(ARCHIVE_MAX + 1))).toBe(true);
  });

  it('sobrevive a un reinicio y escribe de forma atómica con permisos 0600', () => {
    const a = new ArchiveStore(dir);
    a.setSession('jdev-foo-1', 100, true);
    a.setConversation(uuid(7), true);
    const b = new ArchiveStore(dir);
    expect(b.snapshot()).toEqual({ sessions: [{ name: 'jdev-foo-1', created: 100 }], conversations: [uuid(7)] });
    expect(JSON.parse(readFileSync(archivePath(dir), 'utf8'))).toEqual(b.snapshot());
    expect(statSync(archivePath(dir)).mode & 0o777).toBe(0o600);
    // Sin temporales sueltos.
    expect(readdirSync(dir)).toEqual(['archived.json']);
  });

  it('pruneSessions quita las sesiones que ya no existen o cuyo nombre se reutilizó', () => {
    const a = new ArchiveStore(dir);
    a.setSession('jdev-foo-1', 100, true);
    a.setSession('jdev-foo-2', 200, true);
    a.setSession('jdev-foo-3', 300, true);
    expect(a.pruneSessions([{ name: 'jdev-foo-1', created: 100 }, { name: 'jdev-foo-2', created: 999 }])).toBe(true);
    expect(a.snapshot().sessions).toEqual([{ name: 'jdev-foo-1', created: 100 }]);
    expect(a.pruneSessions([{ name: 'jdev-foo-1', created: 100 }])).toBe(false);
    expect(new ArchiveStore(dir).snapshot().sessions).toEqual([{ name: 'jdev-foo-1', created: 100 }]);
  });

  it('no toca las conversaciones al limpiar sesiones', () => {
    const a = new ArchiveStore(dir);
    a.setConversation(uuid(1), true);
    a.setSession('jdev-foo-1', 100, true);
    a.pruneSessions([]);
    expect(a.snapshot()).toEqual({ sessions: [], conversations: [uuid(1)] });
  });
});
