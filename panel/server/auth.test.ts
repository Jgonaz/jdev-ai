import { chmodSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COOKIE_NAME,
  isAuthorized,
  isHostAllowed,
  isOriginAllowed,
  isValidTokenFormat,
  loadOrCreateToken,
  regenerateToken,
  tokenPath,
  tokensMatch,
} from './auth.ts';
import { configDir } from './paths.ts';

let tmp: string;
let dir: string;
let xdgPrevio: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'jdev-auth-'));
  xdgPrevio = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  dir = configDir();
});

afterEach(() => {
  if (xdgPrevio === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = xdgPrevio;
  rmSync(tmp, { recursive: true, force: true });
});

describe('token', () => {
  it('usa XDG_CONFIG_HOME y crea el token de 32 bytes en hex con permisos 0600 y directorio 0700', () => {
    const token = loadOrCreateToken();
    expect(dir).toBe(join(tmp, 'jdev-ai'));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenPath(), 'utf8').trim()).toBe(token);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('reutiliza el token existente', () => {
    expect(loadOrCreateToken()).toBe(loadOrCreateToken());
  });

  it('regenera un token distinto y no deja temporales', () => {
    const a = loadOrCreateToken();
    const b = regenerateToken();
    expect(b).not.toBe(a);
    expect(loadOrCreateToken()).toBe(b);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['panel-token']);
  });

  it('repara permisos demasiado abiertos del archivo existente', () => {
    const token = loadOrCreateToken();
    chmodSync(tokenPath(), 0o644);
    expect(statSync(tokenPath()).mode & 0o077).not.toBe(0);
    expect(loadOrCreateToken()).toBe(token);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
  });

  it('genera uno nuevo si el contenido no es un token válido', () => {
    loadOrCreateToken();
    writeFileSync(tokenPath(), 'basura\n');
    const nuevo = loadOrCreateToken();
    expect(isValidTokenFormat(nuevo)).toBe(true);
  });
});

describe('validación', () => {
  const token = 'a'.repeat(64);

  it('compara tokens en tiempo constante sin fallar con longitudes distintas', () => {
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, 'a'.repeat(63))).toBe(false);
    expect(tokensMatch(token, 'b'.repeat(64))).toBe(false);
    expect(tokensMatch(token, '')).toBe(false);
    expect(tokensMatch(token, undefined)).toBe(false);
  });

  it('acepta Bearer o cookie y rechaza lo demás', () => {
    expect(isAuthorized({ authorization: `Bearer ${token}` }, token)).toBe(true);
    expect(isAuthorized({ cookie: `x=1; ${COOKIE_NAME}=${token}` }, token)).toBe(true);
    expect(isAuthorized({ authorization: 'Bearer otro' }, token)).toBe(false);
    expect(isAuthorized({ authorization: token }, token)).toBe(false);
    expect(isAuthorized({ cookie: `${COOKIE_NAME}=otro` }, token)).toBe(false);
    expect(isAuthorized({}, token)).toBe(false);
  });

  it('valida el origen: propio, localhost y los extra; nunca otro ni ausente', () => {
    expect(isOriginAllowed('http://127.0.0.1:4317', 4317)).toBe(true);
    expect(isOriginAllowed('http://localhost:4317', 4317)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', 4317)).toBe(false);
    expect(isOriginAllowed('http://localhost:5173', 4317, ['http://localhost:5173'])).toBe(true);
    expect(isOriginAllowed('http://evil.example', 4317)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:4318', 4317)).toBe(false);
    expect(isOriginAllowed(undefined, 4317)).toBe(false);
  });

  it('valida la cabecera Host contra DNS rebinding', () => {
    expect(isHostAllowed('localhost:4317', 4317)).toBe(true);
    expect(isHostAllowed('127.0.0.1:4317', 4317)).toBe(true);
    expect(isHostAllowed('evil.example:4317', 4317)).toBe(false);
    expect(isHostAllowed(undefined, 4317)).toBe(false);
  });
});
