import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir } from './paths.ts';
import { DEFAULT_SETTINGS, mergeSettings, readSettings, settingsPath, updateSettings } from './settings.ts';

let tmp: string;
let xdgPrevio: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'jdev-settings-'));
  xdgPrevio = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(() => {
  if (xdgPrevio === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = xdgPrevio;
  rmSync(tmp, { recursive: true, force: true });
});

describe('ajustes', () => {
  it('devuelve los valores por defecto sin archivo', () => {
    const s = readSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.theme.name).toBe('grafito');
    expect(s.port).toBe(4317);
    expect(s.terminal.initialLayout).toBe(1);
    expect(s.newSession).toEqual({ agent: 'claude', location: 'principal' });
  });

  it('acepta «shell» (Terminal sin agente) como agente por defecto y rechaza otros', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { newSession: { agent: 'shell' } }).newSession.agent).toBe('shell');
    expect(mergeSettings(DEFAULT_SETTINGS, { newSession: { agent: 'bash' } }).newSession.agent).toBe('claude');
  });

  it('fusión profunda: un archivo antiguo recibe las claves nuevas', () => {
    updateSettings({ theme: { accent: 'menta' } });
    const s = readSettings();
    expect(s.theme).toEqual({ name: 'grafito', followSystem: false, accent: 'menta' });
    expect(s.personality.grid).toBe(true);
  });

  it('ignora valores fuera de rango, desconocidos y de tipo erróneo', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      theme: { name: 'neon', followSystem: 'sí', accent: 'coral' },
      sizes: { ui: 2, terminal: 400, title: 22.5 },
      terminal: { scrollback: 5, cursor: 'barra', initialLayout: 3 },
      fonts: { ui: 'x; background:url(//evil)', terminal: 'Fira Code, monospace' },
      port: 80,
      desconocida: { a: 1 },
      personality: 'no',
    });
    expect(s.theme).toEqual({ name: 'grafito', followSystem: false, accent: 'coral' });
    expect(s.sizes).toEqual(DEFAULT_SETTINGS.sizes);
    expect(s.terminal.scrollback).toBe(5000);
    expect(s.terminal.cursor).toBe('barra');
    expect(s.terminal.initialLayout).toBe(1);
    expect(s.fonts.ui).toBe(DEFAULT_SETTINGS.fonts.ui);
    expect(s.fonts.terminal).toBe('Fira Code, monospace');
    expect(s.port).toBe(4317);
    expect(s.personality).toEqual(DEFAULT_SETTINGS.personality);
    expect('desconocida' in s).toBe(false);
  });

  it('«Mostrar tu actividad» está activado por defecto, se puede apagar y rechaza lo que no es booleano', () => {
    expect(DEFAULT_SETTINGS.inicio.activity).toBe(true);
    expect(mergeSettings(DEFAULT_SETTINGS, { inicio: { activity: false } }).inicio.activity).toBe(false);
    expect(mergeSettings(DEFAULT_SETTINGS, { inicio: { activity: 'no' } }).inicio.activity).toBe(true);
    // Un archivo guardado antes de existir el ajuste lo recibe activado.
    expect(mergeSettings(DEFAULT_SETTINGS, { theme: { accent: 'menta' } }).inicio).toEqual({ activity: true });
  });

  it('admite tamaños de terminal con medios puntos y la distribución «last»', () => {
    let s = updateSettings({ sizes: { terminal: 12.5 }, terminal: { initialLayout: 'last' } });
    expect(s.sizes.terminal).toBe(12.5);
    expect(s.terminal.initialLayout).toBe('last');
    // Otros decimales, y medios puntos en tamaños enteros, se rechazan.
    s = updateSettings({ sizes: { terminal: 12.3, ui: 14.5 }, terminal: { initialLayout: 3 } });
    expect(s.sizes.terminal).toBe(12.5);
    expect(s.sizes.ui).toBe(14);
    expect(s.terminal.initialLayout).toBe('last');
  });

  it('los valores por defecto de fuentes y barra de estado siguen el diseño', () => {
    expect(DEFAULT_SETTINGS.fonts.ui).toContain('Instrument Sans');
    expect(DEFAULT_SETTINGS.fonts.title).toContain('Martian Mono');
    expect(DEFAULT_SETTINGS.terminal.tmuxBar).toBe(true);
    // Las fuentes por defecto superan la validación del propio servidor.
    expect(mergeSettings(DEFAULT_SETTINGS, { fonts: DEFAULT_SETTINGS.fonts }).fonts).toEqual(DEFAULT_SETTINGS.fonts);
    expect(mergeSettings(DEFAULT_SETTINGS, { fonts: { title: 'inherit' } }).fonts.title).toBe('inherit');
  });

  it('vista previa de imágenes activada y apertura automática desactivada por defecto, con validación', () => {
    expect(DEFAULT_SETTINGS.terminal.hoverPreview).toBe(true);
    expect(DEFAULT_SETTINGS.terminal.autoOpenImages).toBe(false);
    expect(readSettings().terminal.autoOpenImages).toBe(false);
    let s = updateSettings({ terminal: { hoverPreview: false, autoOpenImages: true } });
    expect(s.terminal.hoverPreview).toBe(false);
    expect(s.terminal.autoOpenImages).toBe(true);
    // Un valor que no es booleano se ignora y conserva el anterior.
    s = updateSettings({ terminal: { hoverPreview: 'no', autoOpenImages: 1 } });
    expect(s.terminal.hoverPreview).toBe(false);
    expect(s.terminal.autoOpenImages).toBe(true);
    // Un archivo antiguo sin las claves nuevas toma los valores por defecto.
    writeFileSync(settingsPath(configDir()), JSON.stringify({ terminal: { cursor: 'barra' } }));
    const antiguo = readSettings();
    expect(antiguo.terminal.cursor).toBe('barra');
    expect(antiguo.terminal.hoverPreview).toBe(true);
    expect(antiguo.terminal.autoOpenImages).toBe(false);
  });

  it('nombre del saludo y pantalla al abrir: valores por defecto y validación', () => {
    expect(DEFAULT_SETTINGS.profile).toEqual({ name: '' });
    expect(DEFAULT_SETTINGS.startScreen).toBe('inicio');
    let s = updateSettings({ profile: { name: 'Jorge' }, startScreen: 'terminales' });
    expect(s.profile.name).toBe('Jorge');
    expect(s.startScreen).toBe('terminales');
    // 60 caracteres (aunque sean multibyte) se admiten; 61, no.
    s = updateSettings({ profile: { name: 'ñ'.repeat(60) } });
    expect(s.profile.name).toBe('ñ'.repeat(60));
    for (const malo of ['a'.repeat(61), 'Jor\nge', 'a\tb', 'x\u0000', 'a\u2028b', 3, null]) {
      s = updateSettings({ profile: { name: malo } });
      expect(s.profile.name).toBe('ñ'.repeat(60));
    }
    s = updateSettings({ startScreen: 'proyectos', profile: 'Jorge' });
    expect(s.startScreen).toBe('terminales');
    // El límite son puntos de código: 60 emojis caben, 61 no (como en el cliente).
    expect(updateSettings({ profile: { name: '😀'.repeat(60) } }).profile.name).toBe('😀'.repeat(60));
    expect(updateSettings({ profile: { name: '😀'.repeat(61) } }).profile.name).toBe('😀'.repeat(60));
    // Vaciar el nombre vuelve al de Git.
    expect(updateSettings({ profile: { name: '' } }).profile.name).toBe('');
    // Un archivo antiguo sin las claves nuevas toma los valores por defecto.
    writeFileSync(settingsPath(configDir()), JSON.stringify({ theme: { name: 'papel' } }));
    expect(readSettings()).toMatchObject({ profile: { name: '' }, startScreen: 'inicio' });
  });

  it('un archivo con JSON roto devuelve los valores por defecto', () => {
    updateSettings({ theme: { name: 'papel' } });
    writeFileSync(settingsPath(configDir()), '{no es json');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('PUT parcial: fusiona con lo guardado y devuelve el resultado', () => {
    updateSettings({ theme: { name: 'papel' }, port: 5000 });
    const r = updateSettings({ theme: { accent: 'cian' }, notifications: { system: true } });
    expect(r.theme).toEqual({ name: 'papel', followSystem: false, accent: 'cian' });
    expect(r.port).toBe(5000);
    expect(r.notifications.system).toBe(true);
    expect(readSettings()).toEqual(r);
  });

  it('sonidos de aviso: acepta los del catálogo y conserva el anterior si no es válido', () => {
    expect(readSettings().notifications).toMatchObject({ soundWaiting: 'teletipo', soundFinish: 'gota' });
    updateSettings({ notifications: { soundWaiting: 'campanilla', soundFinish: 'marimba' } });
    updateSettings({ notifications: { soundWaiting: 'sirena', soundFinish: 3 } });
    expect(readSettings().notifications).toMatchObject({ soundWaiting: 'campanilla', soundFinish: 'marimba' });
  });

  it('overrides por proyecto: validación, fusión y borrado con null', () => {
    updateSettings({ projects: { 'balanz.io': { mono: 'bz', color: '#112233', visible: false } } });
    updateSettings({ projects: { 'balanz.io': { mono: 'largo' }, fitnessia: { color: 'rojo', visible: true } } });
    let s = readSettings();
    expect(s.projects['balanz.io']).toEqual({ mono: 'bz', color: '#112233', visible: false });
    expect(s.projects.fitnessia).toEqual({ visible: true });
    s = updateSettings({ projects: { 'balanz.io': { color: null }, fitnessia: null } });
    expect(s.projects).toEqual({ 'balanz.io': { mono: 'bz', visible: false } });
    // Identificadores peligrosos descartados.
    s = updateSettings(JSON.parse('{"projects":{"__proto__":{"mono":"x"},"constructor":{"mono":"ab"}}}'));
    expect(Object.keys(s.projects)).toEqual(['balanz.io', 'constructor']);
    expect(({} as Record<string, unknown>).mono).toBeUndefined();
  });

  it('escribe de forma atómica con permisos 0600 y sin temporales', () => {
    updateSettings({ theme: { name: 'contraste' } });
    const archivo = settingsPath();
    expect(existsSync(archivo)).toBe(true);
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(archivo, 'utf8')).theme.name).toBe('contraste');
    expect(readdirSync(configDir())).toEqual(['panel.json']);
  });
});
