import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { configDir } from './paths.ts';

export const COOKIE_NAME = 'jdev_panel_token';
const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export function tokenPath(dir: string = configDir()): string {
  return join(dir, 'panel-token');
}

export function isValidTokenFormat(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}

// El directorio es solo del usuario y el token se escribe en un archivo
// temporal 0600 que se renombra encima, para que nunca exista con permisos
// más abiertos ni a medio escribir.
export function regenerateToken(dir: string = configDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const token = randomBytes(32).toString('hex');
  const destino = tokenPath(dir);
  const temporal = `${destino}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporal, `${token}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temporal, 0o600);
  renameSync(temporal, destino);
  return token;
}

// Devuelve el token guardado o crea uno nuevo si falta o está corrupto. Si el
// archivo existe con permisos más abiertos que 0600 los corrige.
export function loadOrCreateToken(dir: string = configDir()): string {
  const archivo = tokenPath(dir);
  try {
    const token = readFileSync(archivo, 'utf8').trim();
    if (isValidTokenFormat(token)) {
      if ((statSync(archivo).mode & 0o077) !== 0) chmodSync(archivo, 0o600);
      return token;
    }
  } catch {
    // No existe o no se puede leer: se crea uno nuevo.
  }
  return regenerateToken(dir);
}

// Se compara el hash de ambos valores para que timingSafeEqual reciba siempre
// buffers de la misma longitud y la comparación no dependa del contenido.
export function tokensMatch(esperado: string, candidato: string | undefined | null): boolean {
  if (typeof candidato !== 'string' || candidato === '') return false;
  const a = createHash('sha256').update(esperado).digest();
  const b = createHash('sha256').update(candidato).digest();
  return timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === name) return parte.slice(i + 1).trim();
  }
  return undefined;
}

function bearerValue(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m?.[1];
}

// Acepta el token por cabecera Authorization o por la cookie fijada al abrir
// la URL con ?token=. El token en la URL no se acepta aquí: lo trata el
// servidor HTTP, que lo convierte en cookie y redirige.
export function isAuthorized(headers: IncomingHttpHeaders, token: string): boolean {
  return (
    tokensMatch(token, bearerValue(headers.authorization)) ||
    tokensMatch(token, cookieValue(headers.cookie, COOKIE_NAME))
  );
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

// Orígenes permitidos para los WebSocket y las peticiones que modifican datos:
// el propio panel y, si se usa, el servidor de desarrollo de Vite.
export function allowedOrigins(port: number, extra: readonly string[] = []): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra];
}

export function isOriginAllowed(
  origin: string | undefined,
  port: number,
  extra: readonly string[] = [],
): boolean {
  return typeof origin === 'string' && allowedOrigins(port, extra).includes(origin);
}

// Defensa frente a DNS rebinding: solo se atienden las cabeceras Host propias.
export function isHostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
