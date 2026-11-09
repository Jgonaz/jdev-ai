import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityIndex, INDEX_FILE, INDEX_VERSION } from './activity-index.ts';
import type { FileEntry } from './activity-index.ts';
import { claudeAssistant, codexCall, codexContext, codexMeta, codexTokenCount, fixtureText, makeRoots, put, putFixture } from './activity-fixtures.ts';
import type { TestRoots } from './activity-fixtures.ts';

const DIA = '2026-03-02';
const DIA_CODEX = '2026-03-03';

function totalOf(e: FileEntry, campo: 'r' | 'i' | 'o' | 'cr' | 'cw'): number {
  return Object.values(e.days).reduce((n, d) => n + d[campo], 0);
}
const sum = (m: Record<string, number>[]) => {
  const t: Record<string, number> = {};
  for (const r of m) for (const [k, v] of Object.entries(r)) t[k] = (t[k] ?? 0) + v;
  return t;
};

describe('ActivityIndex', () => {
  let r: TestRoots;
  const nuevo = (extra: Partial<ConstructorParameters<typeof ActivityIndex>[0]> = {}) =>
    new ActivityIndex({ claudeProjectsDir: r.claude, codexSessionsDir: r.codex, cacheDir: r.cache, ...extra });
  const claude = (slug = '-home-dev-alfa', id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') => join(r.claude, slug, `${id}.jsonl`);

  beforeEach(() => {
    r = makeRoots();
  });
  afterEach(() => {
    rmSync(r.tmp, { recursive: true, force: true });
  });

  describe('Claude', () => {
    it('cuenta una vez cada respuesta de la muestra real aunque el transcript la repita', async () => {
      putFixture(claude(), 'claude-session.jsonl');
      const idx = nuevo();
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      // 14 líneas assistant con 8 respuestas distintas (la muestra repite el id de cada bloque).
      expect(totalOf(e, 'r')).toBe(8);
      expect(totalOf(e, 'o')).toBe(3935);
      expect(totalOf(e, 'i')).toBe(16);
      expect(totalOf(e, 'cr')).toBe(224554);
      expect(totalOf(e, 'cw')).toBe(21074);
      expect(Object.keys(e.days)).toEqual([DIA]);
      expect(sum(Object.values(e.days).map((d) => d.t))).toEqual({ Bash: 6, Agent: 1, Write: 1 });
      expect(sum(Object.values(e.days).map((d) => d.a))).toEqual({ implementer: 1 });
      expect(sum(Object.values(e.days).map((d) => d.m))).toEqual({ 'claude-opus-5-5': 8 });
      expect(e.sub).toBe(false);
      expect(idx.updatedAt).not.toBeNull();
      expect(idx.indexing).toBe(false);
    });

    it('suma las horas activas con los huecos de 5 minutos o menos y limita los mayores a 5', async () => {
      put(
        claude(),
        claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }) +
          claudeAssistant({ id: 'msg_b', ts: '2026-03-02T10:02:00.000Z' }) +
          // Hueco de 1 hora: cuenta como 5 minutos.
          claudeAssistant({ id: 'msg_c', ts: '2026-03-02T11:02:00.000Z' }),
      );
      const idx = nuevo();
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      let seg = 0;
      for (let i = 0; i < e.act.length; i += 2) seg += e.act[i + 1]! - e.act[i]!;
      expect(seg).toBe(120 + 300);
    });

    it('con la respuesta repetida en streaming solo suma lo que crece su salida', async () => {
      put(
        claude(),
        claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z', out: 3 }) +
          claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:01.000Z', out: 228, tools: [{ name: 'Read' }] }) +
          // Una línea posterior con menos salida no resta.
          claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:02.000Z', out: 100 }),
      );
      const idx = nuevo();
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      expect(totalOf(e, 'r')).toBe(1);
      expect(totalOf(e, 'o')).toBe(228);
      expect(totalOf(e, 'cr')).toBe(100);
      expect(Object.values(e.days)[0]!.t).toEqual({ Read: 1 });
    });

    it('ignora respuestas sintéticas, sin uso y líneas que no son JSON', async () => {
      put(
        claude(),
        claudeAssistant({ id: 'msg_s', ts: '2026-03-02T10:00:00.000Z', model: '<synthetic>' }) +
          '{"type":"assistant","message":{"id":"msg_x","model":"claude-opus-5-5"},"timestamp":"2026-03-02T10:00:00.000Z"}\n' +
          '{"type":"assistant" esto no es json\n' +
          '{"type":"assistant","timestamp":"no es fecha","message":{"id":"msg_y","model":"m","usage":{}}}\n' +
          claudeAssistant({ id: 'msg_ok', ts: '2026-03-02T10:00:05.000Z' }),
      );
      const idx = nuevo();
      await idx.refresh();
      expect(totalOf([...idx.files.values()][0]!, 'r')).toBe(1);
    });

    it('los subagentes suman uso y herramientas, pero no son sesiones', async () => {
      put(claude(), claudeAssistant({ id: 'msg_p', ts: '2026-03-02T10:00:00.000Z' }));
      const sub = join(r.claude, '-home-dev-alfa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'subagents', 'agent-a1b2.jsonl');
      put(sub, claudeAssistant({ id: 'msg_s1', ts: '2026-03-02T10:00:30.000Z', tools: [{ name: 'Grep' }] }));
      put(join(r.claude, '-home-dev-alfa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'subagents', 'notas.txt'), 'no es un transcript');
      const idx = nuevo();
      await idx.refresh();
      const lista = [...idx.files.values()];
      expect(lista.length).toBe(2);
      expect(lista.filter((e) => e.sub).length).toBe(1);
      expect(lista.reduce((n, e) => n + totalOf(e, 'r'), 0)).toBe(2);
    });

    it('una respuesta repetida en otro transcript (sesión retomada) se cuenta solo en el más antiguo', async () => {
      const original = put(claude('-home-dev-alfa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), claudeAssistant({ id: 'msg_1', ts: '2026-03-02T10:00:00.000Z', out: 10 }));
      const retomada = put(
        claude('-home-dev-beta', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        claudeAssistant({ id: 'msg_1', ts: '2026-03-02T10:00:00.000Z', out: 10 }) + claudeAssistant({ id: 'msg_2', ts: '2026-03-02T10:05:00.000Z', out: 20 }),
      );
      utimesSync(original, new Date(2026, 2, 2), new Date(2026, 2, 2));
      utimesSync(retomada, new Date(2026, 2, 3), new Date(2026, 2, 3));
      const idx = nuevo();
      await idx.refresh();
      const lista = [...idx.files.values()];
      expect(lista.reduce((n, e) => n + totalOf(e, 'r'), 0)).toBe(2);
      expect(lista.reduce((n, e) => n + totalOf(e, 'o'), 0)).toBe(30);
    });

    it('salta las líneas de más de 2 MiB y sigue con las siguientes', async () => {
      const gigante = `{"type":"user","message":{"content":"${'x'.repeat(5000)}"}}\n`;
      put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }) + gigante + claudeAssistant({ id: 'msg_b', ts: '2026-03-02T10:00:10.000Z' }));
      // Con un límite pequeño y trozos de 1 KiB la línea gigante atraviesa varios trozos.
      const idx = nuevo({ maxLineBytes: 2000, chunkBytes: 1024 });
      await idx.refresh();
      expect(totalOf([...idx.files.values()][0]!, 'r')).toBe(2);
    });

    it('una línea que cruza el límite entre trozos se lee entera', async () => {
      let texto = '';
      for (let i = 0; i < 40; i++) texto += claudeAssistant({ id: `msg_${i}`, ts: `2026-03-02T10:${String(i).padStart(2, '0')}:00.000Z` });
      put(claude(), texto);
      const idx = nuevo({ chunkBytes: 97 });
      await idx.refresh();
      expect(totalOf([...idx.files.values()][0]!, 'r')).toBe(40);
    });

    it('no usa claves peligrosas ni deja que una herramienta llamada __proto__ contamine nada', async () => {
      put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z', tools: [{ name: '__proto__' }, { name: 'constructor' }] }));
      const idx = nuevo();
      await idx.refresh();
      const d = Object.values([...idx.files.values()][0]!.days)[0]!;
      expect(Object.hasOwn(d.t, '__proto__')).toBe(false);
      expect(d.t).toEqual({ constructor: 1 });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('Codex', () => {
    const rollout = (id = 'rollout-2026-03-03T10-00-00-aaaa.jsonl') => join(r.codex, '2026', '03', '03', id);

    it('cuenta los token_count de la muestra real, separando la caché de la entrada', async () => {
      putFixture(rollout(), 'codex-rollout.jsonl');
      const idx = nuevo();
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      expect(e.agent).toBe('codex');
      expect(totalOf(e, 'r')).toBe(7);
      expect(totalOf(e, 'i')).toBe(11310);
      expect(totalOf(e, 'o')).toBe(2782);
      expect(totalOf(e, 'cr')).toBe(122112);
      expect(Object.keys(e.days)).toEqual([DIA_CODEX]);
      expect(sum(Object.values(e.days).map((d) => d.t))).toEqual({ exec: 3, request_user_input_async: 2, sleep: 1 });
      expect(Object.keys(sum(Object.values(e.days).map((d) => d.m)))).toEqual(['gpt-6-luna']);
      expect(e.sub).toBe(false);
      expect(e.cwd).toBe('/home/dev/proyectos/jdev-ai/projects/alfa/docs');
    });

    it('un token_count repetido (mismo total acumulado) no es una respuesta nueva', async () => {
      const a = codexTokenCount({ ts: '2026-03-03T10:00:00.000Z', total: 1030 });
      put(rollout(), codexMeta('2026-03-03T09:59:00.000Z', '/home/dev/x') + codexContext('2026-03-03T09:59:01.000Z', 'gpt-6-luna') + a + a + codexTokenCount({ ts: '2026-03-03T10:00:30.000Z', total: 2060 }));
      const idx = nuevo();
      await idx.refresh();
      expect(totalOf([...idx.files.values()][0]!, 'r')).toBe(2);
    });

    it('las sesiones secundarias (subagente, revisión automática) no son sesiones y spawn_agent cuenta el tipo', async () => {
      put(
        rollout('rollout-2026-03-03T10-00-00-sub.jsonl'),
        codexMeta('2026-03-03T10:00:00.000Z', '/home/dev/x', { source: { subagent: { thread_spawn: { parent_thread_id: 'p' } } }, thread_source: 'subagent' }) +
          codexTokenCount({ ts: '2026-03-03T10:00:10.000Z', total: 5 }),
      );
      put(
        rollout('rollout-2026-03-03T10-00-00-main.jsonl'),
        codexMeta('2026-03-03T10:00:00.000Z', '/home/dev/x') +
          codexCall('2026-03-03T10:00:05.000Z', 'spawn_agent', '{"agent_type":"worker"}') +
          codexCall('2026-03-03T10:00:06.000Z', 'spawn_agent', 'no es json') +
          codexTokenCount({ ts: '2026-03-03T10:00:10.000Z', total: 5 }),
      );
      const idx = nuevo();
      await idx.refresh();
      const por: Record<string, FileEntry> = Object.fromEntries([...idx.files].map(([k, e]) => [k.split('-').pop()!, e]));
      expect(por['sub.jsonl']!.sub).toBe(true);
      expect(por['main.jsonl']!.sub).toBe(false);
      expect(Object.values(por['main.jsonl']!.days)[0]!.a).toEqual({ worker: 1, default: 1 });
    });

    it('saca el cwd de un session_meta gigante a partir de su cabeza', async () => {
      const meta = `{"timestamp":"2026-03-03T09:00:00.000Z","type":"session_meta","payload":{"id":"x","cwd":"/home/dev/proyectos/gamma","source":"exec","thread_source":"user","base_instructions":{"text":"${'y'.repeat(5000)}"}}}\n`;
      put(rollout(), meta + codexContext('2026-03-03T09:00:01.000Z', 'gpt-6-luna') + codexTokenCount({ ts: '2026-03-03T10:00:00.000Z', total: 10 }));
      const idx = nuevo({ maxLineBytes: 2000 });
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      expect(e.cwd).toBe('/home/dev/proyectos/gamma');
      expect(totalOf(e, 'r')).toBe(1);
    });

    it('solo recorre carpetas AAAA/MM/DD y archivos rollout-*.jsonl', async () => {
      put(join(r.codex, 'otra', 'rollout-x.jsonl'), codexTokenCount({ ts: '2026-03-03T10:00:00.000Z', total: 1 }));
      put(join(r.codex, '2026', '03', '03', 'notas.jsonl'), codexTokenCount({ ts: '2026-03-03T10:00:00.000Z', total: 1 }));
      const idx = nuevo();
      await idx.refresh();
      expect(idx.files.size).toBe(0);
    });
  });

  describe('lectura incremental', () => {
    it('lee solo lo añadido y espera a que una línea a medias acabe', async () => {
      const f = put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z', out: 10 }));
      const idx = nuevo();
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      const primero = e.offset;
      expect(primero).toBe(statSync(f).size);

      const linea = claudeAssistant({ id: 'msg_b', ts: '2026-03-02T10:01:00.000Z', out: 20 });
      appendFileSync(f, linea.slice(0, 60));
      await idx.refresh();
      expect(totalOf(e, 'r')).toBe(1);
      expect(e.offset).toBe(primero);

      appendFileSync(f, linea.slice(60));
      await idx.refresh();
      expect(totalOf(e, 'r')).toBe(2);
      expect(totalOf(e, 'o')).toBe(30);
      expect(e.offset).toBe(statSync(f).size);

      // Sin cambios no se lee ni se duplica nada.
      await idx.refresh();
      expect(totalOf(e, 'r')).toBe(2);
    });

    it('un archivo que encoge se relee entero sin duplicar', async () => {
      const f = put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }) + claudeAssistant({ id: 'msg_b', ts: '2026-03-02T10:01:00.000Z' }));
      const idx = nuevo();
      await idx.refresh();
      expect(totalOf([...idx.files.values()][0]!, 'r')).toBe(2);
      truncateSync(f, 0);
      writeFileSync(f, claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z', out: 7 }));
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      expect(totalOf(e, 'r')).toBe(1);
      expect(totalOf(e, 'o')).toBe(7);
    });

    it('un archivo reemplazado por otro de otra identidad se relee entero', async () => {
      const f = put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }));
      const idx = nuevo();
      await idx.refresh();
      // El nuevo se crea antes de borrar el viejo (el sistema de archivos podría reutilizar su inode) y es mayor: solo la identidad lo delata.
      put(`${f}.nuevo`, claudeAssistant({ id: 'msg_z', ts: '2026-03-02T10:00:00.000Z', out: 5 }) + claudeAssistant({ id: 'msg_y', ts: '2026-03-02T10:00:10.000Z', out: 6 }));
      renameSync(`${f}.nuevo`, f);
      await idx.refresh();
      const e = [...idx.files.values()][0]!;
      expect(totalOf(e, 'r')).toBe(2);
      expect(totalOf(e, 'o')).toBe(11);
    });

    it('un archivo que desaparece sale del índice', async () => {
      const f = put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }));
      const idx = nuevo();
      await idx.refresh();
      expect(idx.files.size).toBe(1);
      unlinkSync(f);
      await idx.refresh();
      expect(idx.files.size).toBe(0);
    });

    it('una sola pasada a la vez', async () => {
      put(claude(), claudeAssistant({ id: 'msg_a', ts: '2026-03-02T10:00:00.000Z' }));
      const idx = nuevo();
      const a = idx.refresh();
      const b = idx.refresh();
      expect(a).toBe(b);
      await a;
    });
  });

  describe('caché', () => {
    it('guarda un resumen sin contenido, con permisos privados, y otro índice parte de él', async () => {
      putFixture(claude(), 'claude-session.jsonl');
      const idx = nuevo();
      await idx.refresh();
      const ruta = join(r.cache, INDEX_FILE);
      expect(statSync(ruta).mode & 0o777).toBe(0o600);
      const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as { version: number; files: Record<string, unknown> };
      expect(crudo.version).toBe(INDEX_VERSION);
      expect(Object.keys(crudo.files).length).toBe(1);
      expect(readFileSync(ruta, 'utf8')).not.toContain('contenido omitido');
      expect(readdirTmp(r.cache)).toEqual([INDEX_FILE]);

      const otro = nuevo();
      await otro.refresh();
      expect(totalOf([...otro.files.values()][0]!, 'r')).toBe(8);
      // Ya estaba todo leído: la segunda pasada no tenía nada que procesar.
      expect(otro.lastPass).toEqual({ files: 0, bytes: 0 });
      expect(idx.lastPass.files).toBe(1);
    });

    it('con la caché de otra versión o corrupta se reconstruye desde cero', async () => {
      putFixture(claude(), 'claude-session.jsonl');
      put(join(r.cache, INDEX_FILE), JSON.stringify({ version: INDEX_VERSION + 1, files: { 'claude:x': { agent: 'claude' } } }));
      const a = nuevo();
      await a.refresh();
      expect(totalOf([...a.files.values()][0]!, 'r')).toBe(8);
      expect(a.files.size).toBe(1);

      writeFileSync(join(r.cache, INDEX_FILE), '{"version":1,"files":{"claude:');
      const b = nuevo();
      await b.refresh();
      expect(totalOf([...b.files.values()][0]!, 'r')).toBe(8);
      expect(JSON.parse(readFileSync(join(r.cache, INDEX_FILE), 'utf8')).version).toBe(INDEX_VERSION);
    });

    it('descarta las entradas de la caché con forma inválida', async () => {
      putFixture(claude(), 'claude-session.jsonl');
      const base = nuevo();
      await base.refresh();
      const ruta = join(r.cache, INDEX_FILE);
      const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as { files: Record<string, Record<string, unknown>> };
      crudo.files['claude:basura'] = { agent: 'otro' };
      crudo.files['claude:negativos'] = { agent: 'claude', size: -5, offset: 99, days: { '2026-03-02': { r: 'mucho', m: { __proto__: 1 } } } };
      writeFileSync(ruta, JSON.stringify(crudo));
      const idx = nuevo();
      await idx.refresh();
      // Las dos entradas inválidas no existen en disco, así que además salen del índice.
      expect([...idx.files.keys()]).toEqual(['claude:-home-dev-alfa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl']);
    });

    it('borrar la caché no pierde nada: se vuelve a calcular lo mismo', async () => {
      putFixture(claude(), 'claude-session.jsonl');
      const a = nuevo();
      await a.refresh();
      rmSync(r.cache, { recursive: true });
      const b = nuevo();
      await b.refresh();
      expect(totalOf([...b.files.values()][0]!, 'o')).toBe(totalOf([...a.files.values()][0]!, 'o'));
    });
  });

  describe('seguridad', () => {
    it('no sigue enlaces simbólicos ni abre tuberías, y no modifica los transcripts', async () => {
      const real = putFixture(claude(), 'claude-session.jsonl');
      const antes = readFileSync(real, 'utf8');
      const dir = join(r.claude, '-home-dev-alfa');
      symlinkSync(real, join(dir, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl'));
      execFileSync('mkfifo', [join(dir, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl')]);
      // Una carpeta enlazada tampoco se recorre.
      symlinkSync(r.tmp, join(r.claude, '-home-dev-enlace'));
      const idx = nuevo();
      await idx.refresh();
      expect([...idx.files.keys()]).toEqual(['claude:-home-dev-alfa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl']);
      expect(readFileSync(real, 'utf8')).toBe(antes);
    });

    it('si las raíces no existen no falla ni crea nada fuera de la caché', async () => {
      rmSync(r.claude, { recursive: true });
      rmSync(r.codex, { recursive: true });
      const idx = nuevo();
      await idx.refresh();
      expect(idx.files.size).toBe(0);
      expect(idx.updatedAt).not.toBeNull();
      expect(existsSync(r.claude)).toBe(false);
    });
  });
});

function readdirTmp(dir: string): string[] {
  return execFileSync('ls', ['-A', dir]).toString().split('\n').filter(Boolean);
}

// Mantiene la muestra de Claude a mano para que un cambio de fixture rompa la prueba con un mensaje claro.
describe('muestras', () => {
  it('la muestra de Claude lleva 14 líneas assistant y la de Codex 7 token_count', () => {
    expect(fixtureText('claude-session.jsonl').split('\n').filter((l) => l.includes('"type":"assistant"')).length).toBe(14);
    expect(fixtureText('codex-rollout.jsonl').split('\n').filter((l) => l.includes('"token_count"')).length).toBe(7);
  });
});

describe('rendimiento', () => {
  it('indexa decenas de miles de líneas con la mayoría ajena a las respuestas, y la segunda pasada no lee nada', async () => {
    const r = makeRoots();
    try {
      // 24 transcripts de 4 000 líneas: una de cada cuatro es una respuesta; el resto, adjuntos de relleno.
      const relleno = `{"type":"user","message":{"content":"${'z'.repeat(400)}"}}\n`;
      let n = 0;
      for (let f = 0; f < 24; f++) {
        let texto = '';
        for (let i = 0; i < 4000; i++) {
          texto += i % 4 === 0 ? claudeAssistant({ id: `msg_${f}_${i}`, ts: `2026-03-02T10:${String(Math.floor(i / 100) % 60).padStart(2, '0')}:00.000Z` }) : relleno;
        }
        n += 1000;
        put(join(r.claude, `-p${f}`, `aaaaaaaa-aaaa-4aaa-8aaa-${String(f).padStart(12, '0')}.jsonl`), texto);
      }
      const idx = new ActivityIndex({ claudeProjectsDir: r.claude, codexSessionsDir: r.codex, cacheDir: r.cache });
      const t0 = performance.now();
      await idx.refresh();
      const primera = performance.now() - t0;
      expect([...idx.files.values()].reduce((m, e) => m + totalOf(e, 'r'), 0)).toBe(n);
      // Holgado a propósito (en un equipo normal tarda un par de segundos o menos): solo avisa de una regresión grave.
      expect(primera).toBeLessThan(20000);

      const otro = new ActivityIndex({ claudeProjectsDir: r.claude, codexSessionsDir: r.codex, cacheDir: r.cache });
      await otro.refresh();
      expect(otro.lastPass).toEqual({ files: 0, bytes: 0 });
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  });
});
