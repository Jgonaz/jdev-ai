import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSED_MARK, TitleReader, bestTitle, defaultTitle, parseTitle } from './titles.ts';

const titulo = (t: string) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: 's' }) + '\n';
const aiTitulo = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: 's' }) + '\n';
const otra = (n: number) => JSON.stringify({ type: 'user', message: { content: `línea ${n} ${'x'.repeat(100)}` } }) + '\n';

describe('TitleReader', () => {
  let tmp: string;
  let n = 0;
  const reader = new TitleReader();
  const nuevo = (contenido: string) => {
    const ruta = join(tmp, `t${n++}.jsonl`);
    writeFileSync(ruta, contenido);
    return ruta;
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-titles-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('devuelve el último custom-title cuando hay varios', async () => {
    const ruta = nuevo(otra(1) + titulo('Primero') + otra(2) + titulo('Segundo') + otra(3));
    expect(await reader.read(ruta)).toBe('Segundo');
  });

  it('decodifica los escapes JSON y conserva la marca [Closed]', async () => {
    const ruta = nuevo(titulo('[Closed] Arreglar "login" ñandú'));
    expect(await reader.read(ruta)).toBe('[Closed] Arreglar "login" ñandú');
  });

  it('devuelve null sin título, con el archivo vacío, ausente o con líneas rotas', async () => {
    expect(await reader.read(nuevo(otra(1) + otra(2)))).toBeNull();
    expect(await reader.read(nuevo(''))).toBeNull();
    expect(await reader.read(join(tmp, 'no-existe.jsonl'))).toBeNull();
    expect(await reader.read(nuevo('{"type":"custom-title","customTitle":"cortado'))).toBeNull();
    // Un customTitle que no es texto o una línea ajena que lo menciona no cuentan.
    expect(await reader.read(nuevo('{"type":"custom-title","customTitle":5}\n' + otra(1)))).toBeNull();
  });

  it('con un archivo grande lee la cola y, si no hay título en ella, recorre el archivo', async () => {
    const relleno = (k: number) => Array.from({ length: k }, (_, i) => otra(i)).join('');
    // ~700 KB de relleno tras el título: queda fuera de los últimos 256 KB.
    const ruta = nuevo(titulo('Del principio') + relleno(5000));
    expect(await reader.read(ruta)).toBe('Del principio');

    // Un título nuevo al final prevalece (y la caché se invalida por tamaño/mtime).
    appendFileSync(ruta, titulo('[Closed] Del final'));
    expect(await reader.read(ruta)).toBe('[Closed] Del final');

    // Título solo en la cola y archivo grande: no hace falta el recorrido completo.
    const ruta2 = nuevo(relleno(5000) + titulo('En la cola') + relleno(10));
    expect(await reader.read(ruta2)).toBe('En la cola');
  });

  it('recorre solo lo añadido cuando el archivo crece sin título en la cola', async () => {
    const ruta = nuevo(titulo('Antiguo') + Array.from({ length: 4000 }, (_, i) => otra(i)).join(''));
    expect(await reader.read(ruta)).toBe('Antiguo');
    appendFileSync(ruta, Array.from({ length: 100 }, (_, i) => otra(i)).join(''));
    expect(await reader.read(ruta)).toBe('Antiguo');
    appendFileSync(ruta, titulo('Nuevo') + otra(1));
    expect(await reader.read(ruta)).toBe('Nuevo');
  });

  it('cachea por mtime y tamaño', async () => {
    const ruta = nuevo(titulo('Uno'));
    expect(await reader.read(ruta)).toBe('Uno');
    const antes = new Date(Date.now() - 100000);
    utimesSync(ruta, antes, antes);
    expect(await reader.read(ruta)).toBe('Uno');
    // Mismo tamaño y mismo mtime: la caché responde aunque el contenido cambie.
    writeFileSync(ruta, titulo('Dos'));
    utimesSync(ruta, antes, antes);
    expect(await reader.read(ruta)).toBe('Uno');
    // Otro mtime: se relee.
    const despues = new Date(Date.now() - 50000);
    utimesSync(ruta, despues, despues);
    expect(await reader.read(ruta)).toBe('Dos');
  });
});

describe('TitleReader.readTitles (ai-title como alternativa)', () => {
  let tmp: string;
  let n = 0;
  const reader = new TitleReader();
  const nuevo = (contenido: string) => {
    const ruta = join(tmp, `a${n++}.jsonl`);
    writeFileSync(ruta, contenido);
    return ruta;
  };
  const relleno = (k: number) => Array.from({ length: k }, (_, i) => otra(i)).join('');

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-titles-ai-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('devuelve el último de cada tipo y el propio manda en bestTitle', async () => {
    const ruta = nuevo(aiTitulo('IA 1') + otra(1) + titulo('Propio') + aiTitulo('IA 2'));
    const t = await reader.readTitles(ruta);
    expect(t).toEqual({ custom: 'Propio', ai: 'IA 2' });
    expect(bestTitle(t)).toBe('Propio');
    expect(bestTitle({ custom: null, ai: 'IA' })).toBe('IA');
    expect(bestTitle({ custom: null, ai: null })).toBeNull();
  });

  it('read sigue devolviendo solo el customTitle', async () => {
    expect(await reader.read(nuevo(aiTitulo('Solo IA') + otra(1)))).toBeNull();
    expect(await reader.read(nuevo(aiTitulo('IA') + titulo('Propio')))).toBe('Propio');
  });

  it('sin customTitle usa el último aiTitle, también en archivos grandes', async () => {
    expect(await reader.readTitles(nuevo(aiTitulo('Uno') + otra(1) + aiTitulo('Dos')))).toEqual({ custom: null, ai: 'Dos' });
    // Ambos fuera de la cola.
    const grande = nuevo(aiTitulo('Del principio') + relleno(5000));
    expect(await reader.readTitles(grande)).toEqual({ custom: null, ai: 'Del principio' });
    // Un customTitle antiguo fuera de la cola manda aunque haya un aiTitle en la cola.
    const mixto = nuevo(titulo('Antiguo') + relleno(5000) + aiTitulo('Reciente') + relleno(3));
    expect((await reader.readTitles(mixto)).custom).toBe('Antiguo');
    expect((await reader.readTitles(mixto)).ai).toBe('Reciente');
  });

  it('ignora un aiTitle que no es texto o está cortado', async () => {
    expect(await reader.readTitles(nuevo('{"type":"ai-title","aiTitle":5}\n{"type":"ai-title","aiTitle":"cort'))).toEqual({
      custom: null,
      ai: null,
    });
  });
});

describe('parseTitle y defaultTitle', () => {
  it('detecta la marca y limpia el título', () => {
    expect(parseTitle(`${CLOSED_MARK}Arreglar login`)).toEqual({ title: 'Arreglar login', closed: true });
    expect(parseTitle('Arreglar login')).toEqual({ title: 'Arreglar login', closed: false });
    expect(parseTitle('[Closed]sin espacio')).toEqual({ title: '[Closed]sin espacio', closed: false });
    expect(parseTitle(`${CLOSED_MARK}`)).toEqual({ title: '', closed: true });
  });

  it('compone un título por defecto con proyecto, agente y hora', () => {
    const t = defaultTitle('balanz.io', 'claude', new Date(2026, 10, 1, 9, 5).getTime());
    expect(t).toMatch(/^balanz\.io · Claude · 0?9:05$/);
    expect(defaultTitle('x', 'opencode', 0)).toContain('OpenCode');
    expect(defaultTitle('', '', 0)).toContain('sesión');
    // Una terminal sin agente se llama «Terminal»: el proyecto ya se ve en el lugar.
    expect(defaultTitle('balanz.io', 'shell', 0)).toBe('Terminal');
  });
});
