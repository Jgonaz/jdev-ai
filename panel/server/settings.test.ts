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
