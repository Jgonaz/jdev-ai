import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';

type Ajustes = { theme: { name: string } };

describe('servidor', () => {
  const token = 'c'.repeat(64);
  let tmp: string;
  let srv: RunningServer;
  let base: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-server-'));
    mkdirSync(join(tmp, 'harness', 'projects'), { recursive: true });
    mkdirSync(join(tmp, 'dist'));
    writeFileSync(join(tmp, 'dist', 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(join(tmp, 'dist', 'manifest.webmanifest'), '{"name":"jdev-ai"}');
    mkdirSync(join(tmp, 'dist', 'icons'));
    writeFileSync(join(tmp, 'dist', 'icons', 'icon-192.png'), 'png');
    writeFileSync(join(tmp, 'dist', 'secreto.json'), '{}');
    srv = await startServer({
      harnessRoot: join(tmp, 'harness'),
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('responde 401 sin token y sin leer nada', async () => {
    expect((await fetch(`${base}/api/settings`)).status).toBe(401);
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer mal' } })).status).toBe(401);
    const put = await fetch(`${base}/api/settings`, { method: 'PUT', body: '{"port":5000}' });
    expect(put.status).toBe(401);
  });

  it('responde 200 con Bearer', async () => {
    const r = await fetch(`${base}/api/settings`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Ajustes).theme.name).toBe('carbon');
  });

  it('sirve sin token solo el manifiesto y los iconos de la PWA', async () => {
    const m = await fetch(`${base}/manifest.webmanifest`);
    expect(m.status).toBe(200);
    expect(m.headers.get('content-type')).toContain('application/manifest+json');
    expect((await fetch(`${base}/icons/icon-192.png`)).status).toBe(200);
    expect((await fetch(`${base}/icons/no-existe.png`)).status).toBe(404);
    expect((await fetch(`${base}/secreto.json`)).status).toBe(401);
    expect((await fetch(`${base}/icons/..%2Fsecreto.json`)).status).toBe(401);
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/api/settings`)).status).toBe(401);
    expect((await fetch(`${base}/manifest.webmanifest`, { method: 'POST' })).status).toBe(401);
  });

  it('?token= fija una cookie HttpOnly SameSite=Strict y redirige sin el token', async () => {
    const r = await fetch(`${base}/?token=${token}&a=1`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/?a=1');
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=31536000');
    const siguiente = await fetch(`${base}/api/projects`, { headers: { Cookie: cookie.split(';')[0]! } });
    expect(siguiente.status).toBe(200);
    expect(((await siguiente.json()) as { projects: { id: string }[] }).projects.map((p) => p.id)).toEqual(['harness']);
    expect((await fetch(`${base}/?token=mal`, { redirect: 'manual' })).status).toBe(401);
  });

  it('PUT /api/settings acepta parciales y rechaza JSON no válido', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const ok = await fetch(`${base}/api/settings`, { method: 'PUT', headers: h, body: '{"theme":{"name":"papel"}}' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Ajustes).theme.name).toBe('papel');
    expect((await fetch(`${base}/api/settings`, { method: 'PUT', headers: h, body: 'no' })).status).toBe(400);
    const otroOrigen = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { ...h, Origin: 'http://evil.example' },
      body: '{}',
    });
    expect(otroOrigen.status).toBe(403);
  });

  it('sirve index.html como fallback y no sale de dist', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const r = await fetch(`${base}/ruta/del/cliente`, { headers: h });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>x</title>');
    expect((await fetch(`${base}/falta.js`, { headers: h })).status).toBe(404);
    const traversal = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`, { headers: h });
    expect([403, 404]).toContain(traversal.status);
  });

  it('responde 204 a /favicon.ico en lugar de 404', async () => {
    const r = await fetch(`${base}/favicon.ico`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(204);
  });

  it('rechaza un Host ajeno', async () => {
    // fetch no deja cambiar la cabecera Host, así que se usa http directamente.
    const estado = await new Promise<number | undefined>((ok, ko) => {
      const req = request(
        { host: '127.0.0.1', port: srv.port, path: '/api/settings', headers: { Authorization: `Bearer ${token}`, Host: 'evil.example' } },
        (res) => {
          res.resume();
          ok(res.statusCode);
        },
      );
      req.on('error', ko);
      req.end();
    });
    expect(estado).toBe(403);
  });

  it('WebSocket: exige token y origen y envía hello', async () => {
    const url = `ws://127.0.0.1:${srv.port}/ws/events`;
    const intentar = (opts: { headers?: Record<string, string> }) =>
      new Promise<string>((ok) => {
        const ws = new WebSocket(url, opts);
        ws.on('message', (d) => {
          ok(String(d));
          ws.close();
        });
        ws.on('unexpected-response', (_req, res) => ok(`http ${res.statusCode}`));
        ws.on('error', () => ok('error'));
      });
    const bueno = { Authorization: `Bearer ${token}`, Origin: `http://localhost:${srv.port}` };
    expect(JSON.parse(await intentar({ headers: bueno }))).toEqual({ type: 'hello' });
    expect(await intentar({ headers: { Origin: bueno.Origin } })).toBe('http 401');
    expect(await intentar({ headers: { Authorization: bueno.Authorization } })).toBe('http 403');
    expect(await intentar({ headers: { ...bueno, Origin: 'http://evil.example' } })).toBe('http 403');
  });
});
