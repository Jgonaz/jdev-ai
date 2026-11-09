import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node-pty';
import type { IPty } from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';
import {
  isAuthorized,
  isHostAllowed,
  isOriginAllowed,
  loadOrCreateToken,
  regenerateToken,
  sessionCookie,
  tokensMatch,
} from './auth.ts';
import { ArchiveStore } from './archive.ts';
import { BacklogError, BacklogStore, BacklogWatcher, ITEM_ID_RE, pendingChanges, toListItem } from './backlog.ts';
import { commitBacklog, commitPreview, validateCommitRequest } from './backlog-commit.ts';
import { checkNote, isConversationId, isConversationKey, resolveDone } from './conversations.ts';
import { GuideError, listGuides, readGuide } from './guides.ts';
import { HistoryError, HistoryStore, historyDirs, historySignature, isHistoryState, toListEntry } from './history.ts';
import { ImageError, MAX_IMAGE_BYTES, SVG_CSP, defaultImageDirs, openImage } from './images.ts';
import { claudeConfigDir, codexHome, configDir, panelCacheDir, sessionStateDir, uploadsDir } from './paths.ts';
import { ActivityIndex } from './activity-index.ts';
import { buildActivity } from './activity-query.ts';
import { ACTIVITY_AGENTS, ACTIVITY_RANGES } from '../shared/activity.ts';
import type { ActivityAgent, ActivityRange } from '../shared/activity.ts';
import { buildOverview, readGitName } from './overview.ts';
import type { Overview } from './overview.ts';
import { listProjects, worktreeDetails } from './projects.ts';
import type { Project } from './projects.ts';
import { RecentIndex, SESSION_ID } from './recent.ts';
import { SHELL_AGENT, SessionService } from './sessions.ts';
import { DEFAULT_PORT, readSettings, updateSettings } from './settings.ts';
import { checkSessionTitle } from '../shared/session-title.ts';
import { TitleReader, TranscriptRejected, resolveTranscript, stripClosedMark } from './titles.ts';
import {
  SessionInputError,
  TmuxError,
  attachCommand,
  classifyCopyModeInput,
  isPanelSessionName,
  checkScrollRequest,
  paneCurrentPath,
  paneScroll,
  scrollPane,
  leaveCopyMode,
  planSession,
  sessionExists,
  tmuxConfig,
} from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { MAX_UPLOAD_BYTES, UploadError, readUploadBody, saveUpload, startUploadCleanup, uploadType } from './uploads.ts';
import { FollowError, Follower } from './follow.ts';
import { FOLLOW_ID } from '../shared/follow.ts';
import { DEFAULT_WINDOWS_MEDIA, SoundError, listWindowsSounds, openWindowsSound } from './winsounds.ts';

const MAX_BODY = 64 * 1024;

// Tamaño de terminal aceptado en /ws/term: se ajusta a estos límites.
const TERM_COLS = { min: 20, max: 500, def: 80 };
const TERM_ROWS = { min: 5, max: 300, def: 24 };
// Si el cliente va más lento que la terminal, se pausa el pty por encima de esto.
const TERM_BACKPRESSURE = 1024 * 1024;
const CODIGO_SESION_NO_ENCONTRADA = 4404;

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/** Recursos de la PWA que se sirven sin token: el manifiesto y sus iconos. */
export function esRecursoPublico(pathname: string): boolean {
  return pathname === '/manifest.webmanifest' || /^\/icons\/[a-z0-9-]+\.(png|svg)$/.test(pathname);
}

export type ServerOptions = {
  harnessRoot: string;
  /** Puerto de escucha; 0 deja que el sistema elija uno libre. */
  port: number;
  token: string;
  distDir: string;
  configDir: string;
  /** Orígenes adicionales permitidos (p. ej. el servidor de desarrollo de Vite). */
  extraOrigins?: string[];
  /** tmux del panel; por defecto, socket JDEV_PANEL_TMUX_SOCKET o «jdev». */
  tmux?: TmuxConfig;
  /** Directorio de estado de sesiones; por defecto, el de XDG_STATE_HOME. */
  stateDir?: string;
  /** Estado de las conversaciones (hecha o abierta); por defecto, `conversations/` junto a stateDir. */
  conversationsDir?: string;
  /** Statusline y actividad de las sesiones de Claude; por defecto, `statusline/` y `activity/` junto a stateDir. */
  statuslineDir?: string;
  activityDir?: string;
  /** Directorio de configuración de Claude (con projects/ dentro); por defecto, CLAUDE_CONFIG_DIR o ~/.claude. */
  claudeConfigDir?: string;
  /** Raíces bajo las que Claude deja `claude-<uid>/` con la salida de sus shells; por defecto /tmp y TMPDIR. Para pruebas. */
  claudeTmpRoots?: string[];
  /** Directorio de Codex (con sessions/ dentro); por defecto, CODEX_HOME o ~/.codex. */
  codexHome?: string;
  /** Caché del panel (índice de actividad); por defecto, ${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel. */
  cacheDir?: string;
  /** Empezar a indexar la actividad al arrancar, en segundo plano. Solo lo pide el arranque real: así las pruebas no leen ~/.claude ni escriben en la caché. */
  indexActivityAtStart?: boolean;
  /** Carpeta de los sonidos de Windows para los avisos; por defecto, /mnt/c/Windows/Media (WSL). */
  windowsMediaDir?: string;
  /** Carpeta de las imágenes adjuntadas; por defecto, ${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads. */
  uploadsDir?: string;
  /** Carpetas de las que /api/image entrega imágenes; por defecto, las de defaultImageDirs. Para pruebas. */
  imageDirs?: string[];
  /** Límites en bytes de /api/image y /api/uploads, para pruebas. */
  imageMaxBytes?: number;
  uploadMaxBytes?: number;
  /** Intervalos de relectura (ms), para pruebas. */
  pollMs?: number;
  stateFallbackMs?: number;
  /** Relectura de respaldo del backlog (ms); por defecto 10 s. */
  backlogFallbackMs?: number;
  /** Relectura de respaldo del historial (ms); por defecto 15 s. */
  historyFallbackMs?: number;
};

export type RunningServer = {
  server: Server;
  port: number;
  /** Envía un mensaje JSON a todos los clientes de /ws/events. */
  broadcast: (mensaje: unknown) => void;
  close: () => Promise<void>;
};

function sendJson(res: ServerResponse, status: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, ko) => {
    const trozos: Buffer[] = [];
    let total = 0;
    req.on('data', (t: Buffer) => {
      total += t.length;
      if (total > MAX_BODY) {
        ko(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => ok(Buffer.concat(trozos).toString('utf8')));
    req.on('error', ko);
  });
}

// Sirve un archivo de dist/ sin salir de ese directorio; si no existe y no
// parece un recurso (sin extensión), devuelve index.html para el cliente.
function serveStatic(distDir: string, pathname: string, res: ServerResponse): void {
  const raiz = resolve(distDir);
  let ruta: string;
  try {
    ruta = normalize(join(raiz, decodeURIComponent(pathname)));
  } catch {
    sendJson(res, 400, { error: 'ruta no válida' });
    return;
  }
  if (ruta !== raiz && !ruta.startsWith(raiz + sep)) {
    sendJson(res, 403, { error: 'ruta no permitida' });
    return;
  }
  // El navegador pide /favicon.ico por su cuenta aunque index.html declare un icono.
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }
  const esArchivo = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  let archivo = ruta;
  if (!esArchivo(archivo)) {
    if (extname(pathname) !== '') {
      sendJson(res, 404, { error: 'no encontrado' });
      return;
    }
    archivo = join(raiz, 'index.html');
    if (!esArchivo(archivo)) {
      sendJson(res, 404, { error: 'falta panel/dist: ejecuta «pnpm --dir panel build» o usa bin/panel' });
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[extname(archivo).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(archivo).size,
    'Cache-Control': archivo.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(archivo).pipe(res);
}

function clampInt(valor: number, lim: { min: number; max: number }): number {
  return Math.min(lim.max, Math.max(lim.min, valor));
}

// Parámetro entero de la query: undefined si falta, NaN si no es un entero.
function intParam(url: URL, nombre: string): number | undefined {
  const v = url.searchParams.get(nombre);
  if (v === null) return undefined;
  return /^[0-9]{1,6}$/.test(v) ? Number(v) : Number.NaN;
}

function planInputFromQuery(url: URL): Record<string, string> {
  const entrada: Record<string, string> = {};
  for (const k of ['project', 'agent', 'location', 'feature', 'prompt', 'resume']) {
    const v = url.searchParams.get(k);
    if (v !== null) entrada[k] = v;
  }
  return entrada;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const extra = opts.extraOrigins ?? [];
  let puerto = opts.port;
  const tmux = opts.tmux ?? tmuxConfig(opts.harnessRoot);
  const wss = new WebSocketServer({ noServer: true });
  const clientes = new Set<WebSocket>();
  const terminales = new Set<WebSocket>();
  // Sesiones que pueden estar en copy-mode (ratón, Mayús+RePág o la barra de
  // scroll): antes de escribir en ellas se cancela (ver leaveCopyMode). Así no se
  // consulta a tmux con cada tecla.
  const posibleCopyMode = new Set<string>();

  const archivo = new ArchiveStore(opts.configDir);

  const sesiones = new SessionService({
    tmux,
    archive: archivo,
    stateDir: opts.stateDir ?? sessionStateDir(),
    conversationsDir: opts.conversationsDir,
    // Cambia el estado de alguna conversación: las de «Anteriores» no viajan en la lista de sesiones.
    onConversations: () => broadcast({ type: 'conversations' }),
    statuslineDir: opts.statuslineDir,
    activityDir: opts.activityDir,
    claudeProjectsDir: join(opts.claudeConfigDir ?? claudeConfigDir(), 'projects'),
    listProjects: async () => listProjects(opts.harnessRoot, readSettings(opts.configDir).projects),
    onChange: (lista) => broadcast({ type: 'sessions', sessions: lista }),
    onAccount: (account) => broadcast({ type: 'account', account }),
    pollMs: opts.pollMs,
    stateFallbackMs: opts.stateFallbackMs,
  });

  const seguidor = new Follower({ projectsDir: join(opts.claudeConfigDir ?? claudeConfigDir(), 'projects'), tmpRoots: opts.claudeTmpRoots });
  const subidas = opts.uploadsDir ?? uploadsDir();
  const carpetasImagen = opts.imageDirs ?? defaultImageDirs(opts.harnessRoot, subidas);
  const detenerLimpieza = startUploadCleanup(subidas);

  const backlog = new BacklogStore();
  const vigilanteBacklog = new BacklogWatcher({
    projects: async () => (await sesiones.projectList()).map((p) => ({ id: p.id, path: p.path })),
    onChange: (project) => broadcast({ type: 'backlog', project }),
    fallbackMs: opts.backlogFallbackMs,
  });

  const historial = new HistoryStore();
  const vigilanteHistorial = new BacklogWatcher({
    projects: async () => (await sesiones.projectList()).map((p) => ({ id: p.id, path: p.path })),
    onChange: (project) => broadcast({ type: 'history', project }),
    fallbackMs: opts.historyFallbackMs ?? 15000,
    signature: historySignature,
    dirs: historyDirs,
  });

  const projectsDirClaude = join(opts.claudeConfigDir ?? claudeConfigDir(), 'projects');
  const recientes = new RecentIndex({
    projectsDir: projectsDirClaude,
    doneOf: (id, legacyClosed) => resolveDone(sesiones.conversationStates().get(id), legacyClosed),
  });
  const titulosReabrir = new TitleReader();
  // Actividad con los agentes (Inicio › «tu actividad»): índice incremental de
  // los transcripts de Claude y las sesiones de Codex, solo lectura.
  const actividad = new ActivityIndex({
    claudeProjectsDir: projectsDirClaude,
    codexSessionsDir: join(opts.codexHome ?? codexHome(), 'sessions'),
    cacheDir: opts.cacheDir ?? panelCacheDir(),
  });
  const ACTIVIDAD_FRESCA_MS = 60000;
  const ACTIVIDAD_ESPERA_MS = 1500;
  async function activityApi(res: ServerResponse, url: URL, metodo: string): Promise<void> {
    if (metodo !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    const rango = url.searchParams.get('range') ?? 'week';
    const agente = url.searchParams.get('agent') ?? 'all';
    if (!(ACTIVITY_RANGES as readonly string[]).includes(rango) || !(ACTIVITY_AGENTS as readonly string[]).includes(agente)) {
      sendJson(res, 400, { error: 'range (week, 30d, all) o agent (all, claude, codex) no válidos' });
      return;
    }
    // Una visita relee lo nuevo si la última pasada tiene más de 60 s. Si ya hay datos
    // se espera un momento a que acabe; la primera vez no se espera: responde con lo que haya.
    actividad.start();
    if (Date.now() - actividad.lastPassAt > ACTIVIDAD_FRESCA_MS) void actividad.refresh();
    if (actividad.hasData) await actividad.settle(ACTIVIDAD_ESPERA_MS);
    const proyectos = (await sesiones.projectList()).map((p) => ({ id: p.id, name: p.name, path: p.path, mono: p.mono, color: p.color }));
    sendJson(
      res,
      200,
      buildActivity({
        files: actividad.files.values(),
        projects: proyectos,
        range: rango as ActivityRange,
        agent: agente as ActivityAgent,
        now: new Date(),
        indexing: actividad.indexing,
        progress: actividad.progress,
        updatedAt: actividad.updatedAt,
      }),
    );
  }

  // Resumen de Inicio: se calcula al pedirlo y se reutiliza hasta el siguiente
  // aviso de sesiones, backlog o historial (o 10 s, por los cambios de rama y
  // worktrees que no avisan). No hay evento propio: el cliente vuelve a pedirlo
  // con esos avisos, con debounce, y al volver a la ventana.
  const RESUMEN_TTL_MS = 10000;
  let resumen: { at: number; valor: Promise<Overview> } | null = null;
  let nombreGit: Promise<string | null> | null = null;
  const invalidarResumen = () => {
    resumen = null;
  };
  function overview(): Promise<Overview> {
    if (resumen && Date.now() - resumen.at < RESUMEN_TTL_MS) return resumen.valor;
    nombreGit ??= readGitName(opts.harnessRoot);
    const valor = (async () => {
      const todos = await sesiones.projectList();
      // La visibilidad se lee de los ajustes actuales, no de la caché de proyectos.
      const ajustes = readSettings(opts.configDir).projects;
      const visibles = todos.filter((p) => (Object.hasOwn(ajustes, p.id) ? ajustes[p.id]!.visible : undefined) ?? true);
      return buildOverview({
        projects: visibles,
        allProjects: todos,
        // Las archivadas no cuentan en la actividad de Inicio, salvo las que esperan a la persona.
        // Las terminales sin agente tampoco: no son trabajo de un agente.
        sessions: sesiones.list().filter((x) => x.agent !== SHELL_AGENT && (!x.archived || x.state === 'waiting')),
        backlog,
        history: historial,
        gitName: await nombreGit,
      });
    })();
    const entrada = { at: Date.now(), valor };
    resumen = entrada;
    // Un fallo no se queda en la caché.
    valor.catch(() => {
      if (resumen === entrada) resumen = null;
    });
    return valor;
  }

  function broadcast(mensaje: unknown): void {
    const tipo = (mensaje as { type?: unknown } | null)?.type;
    if (tipo === 'sessions' || tipo === 'conversations' || tipo === 'backlog' || tipo === 'history') invalidarResumen();
    const texto = JSON.stringify(mensaje);
    for (const c of clientes) if (c.readyState === WebSocket.OPEN) c.send(texto);
  }

  async function parseJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
    let cuerpo: unknown;
    try {
      const texto = await readBody(req);
      cuerpo = texto.trim() === '' ? {} : JSON.parse(texto);
    } catch {
      sendJson(res, 400, { error: 'JSON no válido' });
      return null;
    }
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      sendJson(res, 400, { error: 'se esperaba un objeto' });
      return null;
    }
    return cuerpo as Record<string, unknown>;
  }

  // Valida la petición de sesión y devuelve el plan, o responde 400.
  async function planFrom(entrada: unknown, res: ServerResponse) {
    try {
      // Sin caché: un worktree recién creado debe poder elegirse enseguida.
      const proyectos = await sesiones.projectList(true);
      const plan = planSession(entrada, proyectos, opts.harnessRoot);
      if (plan.resume) {
        // El transcript debe existir y pertenecer al mismo proyecto y worktree: Claude
        // solo encuentra la sesión desde el directorio donde se creó.
        const origen = await recientes.locate(proyectos, plan.resume);
        if (!origen) throw new SessionInputError('No se encuentra la sesión a retomar en este proyecto.');
        if (origen.project !== plan.project) {
          throw new SessionInputError(`La sesión a retomar pertenece al proyecto «${origen.project}», no a «${plan.project}».`);
        }
        if (origen.worktree !== plan.worktree) {
          throw new SessionInputError(
            origen.worktree
              ? `La sesión a retomar es del worktree «${origen.worktree}»: elige «Worktree existente» con ese worktree.`
              : 'La sesión a retomar es del checkout principal, no de un worktree.',
          );
        }
      }
      return plan;
    } catch (e) {
      if (e instanceof SessionInputError) {
        sendJson(res, 400, { error: e.message });
        return null;
      }
      throw e;
    }
  }

  async function sessionsApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    url: URL,
    metodo: string,
  ): Promise<void> {
    const noPermitido = (permitidos: string) => {
      res.setHeader('Allow', permitidos);
      sendJson(res, 405, { error: 'método no permitido' });
    };

    if (pathname === '/api/sessions') {
      if (metodo === 'GET') {
        // El socket de tmux real permite que el cliente muestre un comando de adjuntar correcto.
        // `home` permite al cliente expandir las rutas «~/…» que aparecen en las terminales.
        sendJson(res, 200, { sessions: await sesiones.refresh(), tmuxSocket: tmux.socket, home: homedir() });
        return;
      }
      if (metodo === 'POST') {
        const cuerpo = await parseJsonBody(req, res);
        if (!cuerpo) return;
        const plan = await planFrom(cuerpo, res);
        if (!plan) return;
        if (cuerpo.dryRun === true) {
          sendJson(res, 200, { dryRun: true, command: plan.command, args: plan.agentArgs });
          return;
        }
        try {
          const sesion = await sesiones.create(plan, { historyLimit: readSettings(opts.configDir).terminal.scrollback });
          // Retomar una conversación archivada la desarchiva: ya está en marcha en el panel.
          if (plan.resume && archivo.hasConversation(plan.resume)) {
            try {
              archivo.setConversation(plan.resume, false);
              broadcast({ type: 'archive' });
            } catch (e) {
              console.error('Error desarchivando la conversación retomada:', e);
            }
          }
          sendJson(res, 201, { session: sesion, command: plan.command });
        } catch (e) {
          console.error('Error creando la sesión:', e);
          sendJson(res, 500, {
            error: `No se pudo crear la sesión de tmux${e instanceof TmuxError ? `: ${e.stderr.trim() || e.message}` : ''}`,
          });
        }
        return;
      }
      noPermitido('GET, POST');
      return;
    }

    if (pathname === '/api/sessions/preview') {
      if (metodo !== 'GET') return noPermitido('GET');
      const plan = await planFrom(planInputFromQuery(url), res);
      if (plan) sendJson(res, 200, { dryRun: true, command: plan.command, args: plan.agentArgs });
      return;
    }

    // GET: lo nuevo de un subagente o una shell en segundo plano de la sesión, por
    // lectura incremental desde el byte `from`. Solo sesiones del panel; los
    // archivos los localiza y valida el servidor (no se acepta ninguna ruta).
    const seg = /^\/api\/sessions\/([^/]+)\/follow\/(agent|shell)\/([^/]+)$/.exec(pathname);
    if (seg) {
      if (metodo !== 'GET') return noPermitido('GET');
      let nombre: string;
      let id: string;
      try {
        nombre = decodeURIComponent(seg[1]!);
        id = decodeURIComponent(seg[3]!);
      } catch {
        sendJson(res, 400, { error: 'identificador no válido' });
        return;
      }
      if (!isPanelSessionName(nombre)) {
        sendJson(res, 400, { error: 'nombre de sesión no válido: solo se admiten sesiones del panel (jdev-*)' });
        return;
      }
      if (!FOLLOW_ID.test(id)) {
        sendJson(res, 400, { error: 'identificador no válido' });
        return;
      }
      const crudo = url.searchParams.get('from');
      const from = crudo === null ? null : /^\d{1,15}$/.test(crudo) ? Number(crudo) : NaN;
      if (from !== null && Number.isNaN(from)) {
        sendJson(res, 400, { error: 'El parámetro «from» debe ser un número de bytes.' });
        return;
      }
      const contexto = sesiones.followContext(nombre);
      if (!contexto) {
        sendJson(res, 404, { error: 'No hay datos que mostrar: la sesión no existe o aún no ha dejado actividad.' });
        return;
      }
      try {
        const cuerpo = seg[2] === 'agent' ? await seguidor.agent(contexto, id, from ?? 0) : await seguidor.shell(contexto, id, from);
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, cuerpo);
      } catch (e) {
        if (e instanceof FollowError) {
          sendJson(res, e.status, { error: e.message });
          return;
        }
        console.error('Error leyendo el seguimiento:', e);
        sendJson(res, 500, { error: 'No se pudo leer el seguimiento.' });
      }
      return;
    }

    const t = /^\/api\/sessions\/([^/]+)\/title$/.exec(pathname);
    if (t) {
      if (metodo !== 'PUT') return noPermitido('PUT');
      let nombre: string;
      try {
        nombre = decodeURIComponent(t[1]!);
      } catch {
        sendJson(res, 400, { error: 'nombre de sesión no válido' });
        return;
      }
      if (!isPanelSessionName(nombre)) {
        sendJson(res, 400, { error: 'nombre de sesión no válido: solo se pueden renombrar sesiones del panel (jdev-*)' });
        return;
      }
      const cuerpo = await parseJsonBody(req, res);
      if (!cuerpo) return;
      const titulo = checkSessionTitle(cuerpo.title);
      if (!titulo.ok) {
        sendJson(res, 400, { error: titulo.error });
        return;
      }
      try {
        if (!(await sesiones.rename(nombre, titulo.title))) {
          sendJson(res, 404, { error: 'la sesión no existe' });
          return;
        }
      } catch (e) {
        if (e instanceof TranscriptRejected) {
          sendJson(res, 409, { error: e.message });
          return;
        }
        console.error('Error renombrando la sesión:', e);
        sendJson(res, 500, { error: 'No se pudo renombrar la sesión.' });
        return;
      }
      sendJson(res, 200, { renamed: true, name: nombre, title: sesiones.list().find((s) => s.name === nombre)?.title ?? titulo.title });
      return;
    }

    // GET: posición en el historial de tmux (la barra de scroll sondea esto solo
    // mientras hace falta). POST: mueve la vista (arriba, abajo, página, línea).
    const sc = /^\/api\/sessions\/([^/]+)\/scroll$/.exec(pathname);
    if (sc) {
      if (metodo !== 'GET' && metodo !== 'POST') return noPermitido('GET, POST');
      let nombre: string;
      try {
        nombre = decodeURIComponent(sc[1]!);
      } catch {
        sendJson(res, 400, { error: 'nombre de sesión no válido' });
        return;
      }
      if (!isPanelSessionName(nombre)) {
        sendJson(res, 400, { error: 'nombre de sesión no válido: solo se admiten sesiones del panel (jdev-*)' });
        return;
      }
      let estado;
      if (metodo === 'GET') {
        estado = await paneScroll(tmux, nombre);
      } else {
        const cuerpo = await parseJsonBody(req, res);
        if (!cuerpo) return;
        let peticion;
        try {
          peticion = checkScrollRequest(cuerpo);
        } catch (e) {
          if (!(e instanceof SessionInputError)) throw e;
          sendJson(res, 400, { error: e.message });
          return;
        }
        posibleCopyMode.add(nombre);
        estado = await scrollPane(tmux, nombre, peticion);
      }
      if (estado === null) {
        sendJson(res, 404, { error: 'la sesión no existe' });
        return;
      }
      sendJson(res, 200, estado);
      return;
    }

    const m = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
    if (m) {
      if (metodo !== 'DELETE') return noPermitido('DELETE');
      let nombre: string;
      try {
        nombre = decodeURIComponent(m[1]!);
      } catch {
        sendJson(res, 400, { error: 'nombre de sesión no válido' });
        return;
      }
      if (!isPanelSessionName(nombre)) {
        sendJson(res, 400, { error: 'nombre de sesión no válido: solo se pueden terminar sesiones del panel (jdev-*)' });
        return;
      }
      // Terminar una sesión es destructivo: exige confirmación explícita.
      let confirmado = req.headers['x-jdev-confirm'] === 'yes';
      if (!confirmado) {
        const cuerpo = await readBody(req).then((t) => (t.trim() === '' ? {} : JSON.parse(t) as unknown)).catch(() => ({}));
        confirmado = typeof cuerpo === 'object' && cuerpo !== null && (cuerpo as { confirm?: unknown }).confirm === true;
      }
      if (!confirmado) {
        sendJson(res, 400, {
          error: 'Falta la confirmación: envía la cabecera «X-Jdev-Confirm: yes» o el cuerpo {"confirm":true}.',
        });
        return;
      }
      if (!(await sesiones.kill(nombre))) {
        sendJson(res, 404, { error: 'la sesión no existe' });
        return;
      }
      sendJson(res, 200, { deleted: true, name: nombre });
      return;
    }
    sendJson(res, 404, { error: 'no encontrado' });
  }

  // GET/HEAD /api/image?session=<jdev-*>&path=<ruta>: entrega una imagen de las
  // carpetas permitidas. Una ruta relativa se resuelve contra el directorio
  // actual de la terminal de la sesión; una absoluta no necesita sesión.
  async function imageApi(res: ServerResponse, url: URL, metodo: string): Promise<void> {
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    const ruta = url.searchParams.get('path');
    const sesion = url.searchParams.get('session');
    if (ruta === null || ruta === '') {
      sendJson(res, 400, { error: 'Indica la ruta de la imagen.' });
      return;
    }
    let cwd: string | null = null;
    if (sesion !== null && sesion !== '') {
      if (!isPanelSessionName(sesion)) {
        sendJson(res, 400, { error: 'nombre de sesión no válido: solo se admiten sesiones del panel (jdev-*)' });
        return;
      }
      if (!isAbsolute(ruta)) {
        cwd = await paneCurrentPath(tmux, sesion);
        if (cwd === null) {
          sendJson(res, 404, { error: 'La sesión no existe.' });
          return;
        }
      }
    }
    let imagen;
    try {
      imagen = await openImage({ path: ruta, cwd, allowedDirs: carpetasImagen, maxBytes: opts.imageMaxBytes ?? MAX_IMAGE_BYTES });
    } catch (e) {
      if (e instanceof ImageError) {
        sendJson(res, e.status, { error: e.message });
        return;
      }
      throw e;
    }
    res.writeHead(200, {
      'Content-Type': imagen.contentType,
      'Content-Length': imagen.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'X-Image-Size': imagen.size,
      // Ruta real (absoluta y sin enlaces) codificada con encodeURIComponent: las cabeceras no admiten
      // cualquier carácter. Permite al visor deduplicar por archivo y mostrar la carpeta resuelta.
      'X-Image-Path': encodeURIComponent(imagen.file),
      ...(imagen.width !== undefined && imagen.height !== undefined
        ? { 'X-Image-Width': imagen.width, 'X-Image-Height': imagen.height }
        : {}),
      ...(imagen.kind === 'svg' ? { 'Content-Security-Policy': SVG_CSP } : {}),
    });
    if (metodo === 'HEAD') {
      await imagen.handle.close();
      res.end();
      return;
    }
    // end = size - 1: si el archivo crece mientras se lee, no se pasa del tamaño anunciado.
    pipeline(imagen.handle.createReadStream({ start: 0, end: imagen.size - 1 }), res, () => {});
  }

  // POST /api/uploads: cuerpo binario con el Content-Type de la imagen.
  async function uploadsApi(req: IncomingMessage, res: ServerResponse, metodo: string): Promise<void> {
    if (metodo !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    try {
      uploadType(req.headers['content-type']);
      const cuerpo = await readUploadBody(req, opts.uploadMaxBytes ?? MAX_UPLOAD_BYTES);
      sendJson(res, 201, await saveUpload(cuerpo, req.headers['content-type'], subidas));
    } catch (e) {
      if (!(e instanceof UploadError)) throw e;
      // Con el cuerpo sin leer, la conexión no se puede reutilizar: se cierra
      // tras responder para que el resto de la subida no siga llegando.
      if (!req.complete) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      sendJson(res, e.status, { error: e.message });
    }
  }

  // Proyecto por identificador; si no está en la caché, se reintenta sin ella por si es nuevo.
  async function findProject(id: string): Promise<Project | undefined> {
    return (await sesiones.projectList()).find((p) => p.id === id) ?? (await sesiones.projectList(true)).find((p) => p.id === id);
  }

  // /api/projects/:id/{backlog,guides,worktrees}[/...]: lectura del backlog, las
  // guías y los worktrees del proyecto, y cambio de estado de un elemento.
  async function projectApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    url: URL,
    metodo: string,
  ): Promise<void> {
    const m = /^\/api\/projects\/([^/]+)\/(backlog|guides|worktrees)(?:\/(.*))?$/.exec(pathname);
    if (!m) {
      sendJson(res, 404, { error: 'no encontrado' });
      return;
    }
    const soloMetodo = (permitido: string): boolean => {
      if (metodo === permitido) return true;
      res.setHeader('Allow', permitido);
      sendJson(res, 405, { error: 'método no permitido' });
      return false;
    };
    let id: string;
    try {
      id = decodeURIComponent(m[1]!);
    } catch {
      sendJson(res, 400, { error: 'identificador de proyecto no válido' });
      return;
    }
    const recurso = m[2]!;
    const resto = m[3] ?? '';
    const proyecto = await findProject(id);
    if (!proyecto) {
      sendJson(res, 404, { error: 'El proyecto no existe.' });
      return;
    }

    if (recurso === 'backlog') {
      if (resto === '') {
        if (!soloMetodo('GET')) return;
        const [lista, pending] = await Promise.all([backlog.list(proyecto.path), pendingChanges(proyecto.path)]);
        sendJson(res, 200, { items: lista.items.map(toListItem), pending, hasBacklog: lista.hasBacklog });
        return;
      }
      if (resto === 'commit-preview') {
        if (!soloMetodo('GET')) return;
        try {
          sendJson(res, 200, await commitPreview(proyecto.path));
        } catch (err) {
          if (!(err instanceof BacklogError)) throw err;
          sendJson(res, err.status, { error: err.message });
        }
        return;
      }
      if (resto === 'commit') {
        if (!soloMetodo('POST')) return;
        const cuerpo = await parseJsonBody(req, res);
        if (!cuerpo) return;
        const fase = (phase: string) => broadcast({ type: 'backlog-commit', project: proyecto.id, phase });
        try {
          const peticion = validateCommitRequest({ message: cuerpo.message, push: cuerpo.push, fingerprint: cuerpo.fingerprint });
          // En la cola de los movimientos: ningún `git mv` del panel se cuela a medias en el commit.
          const r = await backlog.exclusive(proyecto.path, () => commitBacklog(proyecto.path, peticion, fase));
          await vigilanteBacklog.mark(proyecto.id);
          broadcast({ type: 'backlog', project: proyecto.id });
          const { status, ...respuesta } = r;
          sendJson(res, status, respuesta);
        } catch (err) {
          if (!(err instanceof BacklogError)) throw err;
          sendJson(res, err.status, { error: err.message });
        }
        return;
      }
      const e = /^([^/]+)(\/move)?$/.exec(resto);
      if (!e || !ITEM_ID_RE.test(e[1]!)) {
        sendJson(res, e ? 400 : 404, { error: e ? 'Identificador de elemento no válido.' : 'no encontrado' });
        return;
      }
      const itemId = e[1]!;
      if (!e[2]) {
        if (!soloMetodo('GET')) return;
        const item = await backlog.get(proyecto.path, itemId);
        if (!item) sendJson(res, 404, { error: 'El elemento no existe.' });
        else sendJson(res, 200, { item });
        return;
      }
      if (!soloMetodo('POST')) return;
      const cuerpo = await parseJsonBody(req, res);
      if (!cuerpo) return;
      try {
        const item = await backlog.move(proyecto.path, itemId, cuerpo.to, cuerpo.etag);
        await vigilanteBacklog.mark(proyecto.id);
        broadcast({ type: 'backlog', project: proyecto.id });
        sendJson(res, 200, { item });
      } catch (err) {
        if (!(err instanceof BacklogError)) throw err;
        if (err.status >= 500) console.error('Error moviendo el elemento del backlog:', err.message);
        sendJson(res, err.status, err.item ? { error: err.message, item: err.item } : { error: err.message });
      }
      return;
    }

    if (recurso === 'guides') {
      if (!soloMetodo('GET')) return;
      if (resto === '') {
        sendJson(res, 200, { guides: await listGuides(proyecto.path) });
        return;
      }
      if (resto !== 'content') {
        sendJson(res, 404, { error: 'no encontrado' });
        return;
      }
      try {
        sendJson(res, 200, await readGuide(proyecto.path, url.searchParams.get('path') ?? ''));
      } catch (err) {
        if (!(err instanceof GuideError)) throw err;
        sendJson(res, err.status, { error: err.message });
      }
      return;
    }

    // worktrees
    if (resto !== '') {
      sendJson(res, 404, { error: 'no encontrado' });
      return;
    }
    if (!soloMetodo('GET')) return;
    // Sin caché: el cliente quiere ver los worktrees y ramas recién creados.
    const actual = (await sesiones.projectList(true)).find((p) => p.id === proyecto.id) ?? proyecto;
    sendJson(res, 200, await worktreeDetails(actual, await sesiones.refresh()));
  }

  // /api/history[/:project/:file[/pending]]: lista filtrada, detalle y marca de
  // pendientes del historial del checkout principal de cada proyecto, y
  // /api/history/pending/mark-old: limpieza de los de entradas anteriores.
  async function historyApi(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL, metodo: string): Promise<void> {
    const soloMetodo = (permitido: string): boolean => {
      if (metodo === permitido) return true;
      res.setHeader('Allow', permitido);
      sendJson(res, 405, { error: 'método no permitido' });
      return false;
    };
    if (pathname === '/api/history') {
      if (!soloMetodo('GET')) return;
      const proyecto = url.searchParams.get('project') || null;
      const estado = url.searchParams.get('state') || null;
      if (estado !== null && !isHistoryState(estado)) {
        sendJson(res, 400, { error: 'Estado no válido: usa finalizada, en curso, bloqueada o desconocido.' });
        return;
      }
      if (proyecto !== null && !(await findProject(proyecto))) {
        sendJson(res, 404, { error: 'El proyecto no existe.' });
        return;
      }
      const lista = await historial.list(
        (await sesiones.projectList()).map((p) => ({ id: p.id, path: p.path })),
        { project: proyecto, state: estado, pending: url.searchParams.get('pending') === '1' },
      );
      sendJson(res, 200, { entries: lista });
      return;
    }
    // Antes que el detalle: «mark-old» no es un nombre de entrada válido (sin `.md`).
    if (pathname === '/api/history/pending/mark-old') {
      if (!soloMetodo('POST')) return;
      const cuerpo = await parseJsonBody(req, res);
      if (!cuerpo) return;
      const pedido = cuerpo.project;
      if (pedido !== undefined && pedido !== null && (typeof pedido !== 'string' || pedido === '')) {
        sendJson(res, 400, { error: '«project» debe ser el identificador de un proyecto.' });
        return;
      }
      const todos = (await sesiones.projectList()).map((p) => ({ id: p.id, path: p.path }));
      const elegidos = typeof pedido === 'string' ? todos.filter((p) => p.id === pedido) : todos;
      if (typeof pedido === 'string' && elegidos.length === 0) {
        sendJson(res, 404, { error: 'El proyecto no existe.' });
        return;
      }
      const r = await historial.markOld(elegidos);
      for (const id of r.projects) {
        await vigilanteHistorial.mark(id);
        broadcast({ type: 'history', project: id });
      }
      sendJson(res, 200, { marked: r.marked, entries: r.entries, skipped: r.skipped });
      return;
    }
    const m = /^\/api\/history\/([^/]+)\/([^/]+)(\/pending)?$/.exec(pathname);
    if (!m) {
      sendJson(res, 404, { error: 'no encontrado' });
      return;
    }
    let id: string;
    let file: string;
    try {
      id = decodeURIComponent(m[1]!);
      file = decodeURIComponent(m[2]!);
    } catch {
      sendJson(res, 400, { error: 'ruta no válida' });
      return;
    }
    const proyecto = await findProject(id);
    if (!proyecto) {
      sendJson(res, 404, { error: 'El proyecto no existe.' });
      return;
    }
    const destino = { id: proyecto.id, path: proyecto.path };
    try {
      if (!m[3]) {
        if (!soloMetodo('GET')) return;
        sendJson(res, 200, { entry: await historial.get(destino, file) });
        return;
      }
      if (!soloMetodo('POST')) return;
      const cuerpo = await parseJsonBody(req, res);
      if (!cuerpo) return;
      const entry = await historial.setPending(destino, file, cuerpo.index, cuerpo.done, cuerpo.etag);
      await vigilanteHistorial.mark(proyecto.id);
      broadcast({ type: 'history', project: proyecto.id });
      sendJson(res, 200, { entry });
    } catch (err) {
      if (!(err instanceof HistoryError)) throw err;
      if (err.status >= 500) console.error('Error marcando el pendiente del historial:', err.message);
      sendJson(res, err.status, err.entry ? { error: err.message, entry: err.entry } : { error: err.message });
    }
  }

  // PUT /api/archive {kind: 'session' | 'conversation', id, archived}: archiva o
  // desarchiva una sesión del panel (su nombre de tmux) o una conversación de
  // «Anteriores» (su id de Claude) y responde con la lista actual. No toca la
  // sesión ni el transcript: solo la lista de archived.json.
  async function archiveApi(req: IncomingMessage, res: ServerResponse, metodo: string): Promise<void> {
    if (metodo !== 'PUT') {
      res.setHeader('Allow', 'PUT');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    const cuerpo = await parseJsonBody(req, res);
    if (!cuerpo) return;
    const { kind, id, archived } = cuerpo;
    if (kind !== 'session' && kind !== 'conversation') {
      sendJson(res, 400, { error: 'kind debe ser «session» o «conversation»' });
      return;
    }
    if (typeof archived !== 'boolean') {
      sendJson(res, 400, { error: 'archived debe ser true o false' });
      return;
    }
    if (typeof id !== 'string' || !(kind === 'session' ? isPanelSessionName(id) : SESSION_ID.test(id))) {
      sendJson(res, 400, {
        error: kind === 'session' ? 'id no válido: se esperaba el nombre de una sesión del panel (jdev-*)' : 'id no válido: se esperaba el id de una conversación',
      });
      return;
    }
    try {
      if (kind === 'session') {
        if (!(await sesiones.setArchived(id, archived))) {
          sendJson(res, 404, { error: 'la sesión no existe' });
          return;
        }
      } else {
        archivo.setConversation(id, archived);
      }
    } catch (e) {
      console.error('Error guardando las archivadas:', e);
      sendJson(res, 500, { error: 'No se pudo guardar la lista de archivadas.' });
      return;
    }
    // Las sesiones ya viajan por su propio evento; esto avisa a otras ventanas de que recarguen las conversaciones.
    broadcast({ type: 'archive' });
    sendJson(res, 200, archivo.snapshot());
  }

  // PUT /api/conversations/:clave/state {state: 'done' | 'open', note?}: marca una
  // conversación como hecha o la reabre, como la persona. La clave es el id de una
  // conversación de Claude conocida (de una sesión del panel o de «Anteriores») o
  // `tmux-…` de una sesión del panel sin conversación de Claude. Al reabrir, si el
  // título guardado lleva la marca antigua «[Closed] » se quita. No toca la sesión.
  async function conversationApi(req: IncomingMessage, res: ServerResponse, pathname: string, metodo: string): Promise<void> {
    const m = /^\/api\/conversations\/([^/]+)\/state$/.exec(pathname);
    if (!m) {
      sendJson(res, 404, { error: 'no encontrado' });
      return;
    }
    if (metodo !== 'PUT') {
      res.setHeader('Allow', 'PUT');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    let clave: string;
    try {
      clave = decodeURIComponent(m[1]!);
    } catch {
      sendJson(res, 400, { error: 'clave de conversación no válida' });
      return;
    }
    if (!isConversationKey(clave)) {
      sendJson(res, 400, { error: 'clave de conversación no válida: se esperaba el id de una conversación o el de una sesión del panel sin conversación' });
      return;
    }
    const cuerpo = await parseJsonBody(req, res);
    if (!cuerpo) return;
    const { state } = cuerpo;
    if (state !== 'done' && state !== 'open') {
      sendJson(res, 400, { error: 'state debe ser «done» u «open»' });
      return;
    }
    if (state === 'open' && cuerpo.note !== undefined) {
      sendJson(res, 400, { error: 'la nota solo se admite al marcar como hecha' });
      return;
    }
    const nota = checkNote(cuerpo.note);
    if (!nota.ok) {
      sendJson(res, 400, { error: nota.error });
      return;
    }
    // Solo conversaciones que el panel conoce: las de sus sesiones o las de «Anteriores».
    await sesiones.refresh();
    const proyectos = await sesiones.projectList();
    const sesion = sesiones.list().find((s) => s.conversationKey === clave);
    let transcript: string | null = null;
    if (isConversationId(clave)) {
      transcript = sesiones.transcriptOf(clave);
      if (transcript === null) transcript = await recientes.transcriptPath(proyectos, clave);
    }
    if (!sesion && transcript === null) {
      sendJson(res, 404, { error: 'la conversación no existe' });
      return;
    }
    if (sesion?.agent === SHELL_AGENT) {
      sendJson(res, 400, { error: 'una terminal sin agente no tiene conversación' });
      return;
    }
    let entrada;
    try {
      entrada = await sesiones.setConversation(clave, state, state === 'done' ? nota.note : null);
    } catch (e) {
      console.error('Error guardando el estado de la conversación:', e);
      sendJson(res, 500, { error: 'No se pudo guardar el estado de la conversación.' });
      return;
    }
    if (state === 'open' && transcript !== null) {
      // Con el estado ya guardado, la marca antigua es solo ruido: si no se puede quitar, no se falla.
      try {
        const real = await resolveTranscript(transcript, projectsDirClaude);
        if (real && (await stripClosedMark(titulosReabrir, real, clave))) await sesiones.refresh();
      } catch (e) {
        console.error('No se pudo quitar la marca «[Closed]» del título:', e instanceof Error ? e.message : e);
      }
    }
    sendJson(res, 200, { key: clave, state: entrada.state, done: resolveDone(entrada, false) });
  }

  async function api(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const metodo = req.method ?? 'GET';
    // Una cookie SameSite=Strict ya frena el CSRF; además, si el navegador
    // declara un origen en una petición que modifica datos, debe ser el propio.
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      const origen = req.headers.origin;
      if (origen !== undefined && !isOriginAllowed(origen, puerto, extra)) {
        sendJson(res, 403, { error: 'origen no permitido' });
        return;
      }
    }
    if (pathname === '/api/settings') {
      if (metodo === 'GET') {
        sendJson(res, 200, readSettings(opts.configDir));
        return;
      }
      if (metodo === 'PUT') {
        let parche: unknown;
        try {
          parche = JSON.parse(await readBody(req));
        } catch {
          sendJson(res, 400, { error: 'JSON no válido' });
          return;
        }
        if (typeof parche !== 'object' || parche === null || Array.isArray(parche)) {
          sendJson(res, 400, { error: 'se esperaba un objeto' });
          return;
        }
        sendJson(res, 200, updateSettings(parche, opts.configDir));
        invalidarResumen();
        return;
      }
      res.setHeader('Allow', 'GET, PUT');
      sendJson(res, 405, { error: 'método no permitido' });
      return;
    }
    if (pathname === '/api/projects') {
      if (metodo !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      const ajustes = readSettings(opts.configDir);
      sendJson(res, 200, { projects: await listProjects(opts.harnessRoot, ajustes.projects) });
      return;
    }
    if (pathname.startsWith('/api/projects/')) {
      await projectApi(req, res, pathname, new URL(req.url ?? '/', 'http://127.0.0.1'), metodo);
      return;
    }
    if (pathname === '/api/history' || pathname.startsWith('/api/history/')) {
      await historyApi(req, res, pathname, new URL(req.url ?? '/', 'http://127.0.0.1'), metodo);
      return;
    }
    if (pathname.startsWith('/api/conversations/')) {
      await conversationApi(req, res, pathname, metodo);
      return;
    }
    if (pathname === '/api/archive') {
      await archiveApi(req, res, metodo);
      return;
    }
    if (pathname === '/api/recent') {
      if (metodo !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      // Se actualiza la lista de sesiones del panel para no ofrecer las que ya están en él.
      await sesiones.refresh();
      const lista = await recientes.list(await sesiones.projectList(), sesiones.panelSessionIds(), archivo.snapshot().conversations);
      sendJson(res, 200, { recent: lista.map((r) => ({ ...r, archived: archivo.hasConversation(r.id) })) });
      return;
    }
    if (pathname === '/api/account') {
      if (metodo !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      // Límites de 5 h y 7 días de la statusline más reciente de una sesión de Claude del panel.
      await sesiones.refresh();
      sendJson(res, 200, { account: sesiones.accountLimits() });
      return;
    }
    // Sonidos de Windows para los avisos: la lista y cada .wav, servidos desde el
    // disco de la persona (solo lectura, nombres validados, dentro de la carpeta).
    if (pathname === '/api/sounds') {
      if (metodo !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      sendJson(res, 200, { windows: await listWindowsSounds(opts.windowsMediaDir ?? DEFAULT_WINDOWS_MEDIA) });
      return;
    }
    const snd = /^\/api\/sounds\/windows\/([^/]+)$/.exec(pathname);
    if (snd) {
      if (metodo !== 'GET' && metodo !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      let nombre: string;
      try {
        nombre = decodeURIComponent(snd[1]!);
      } catch {
        sendJson(res, 400, { error: 'Nombre de sonido no válido.' });
        return;
      }
      let sonido;
      try {
        sonido = await openWindowsSound(opts.windowsMediaDir ?? DEFAULT_WINDOWS_MEDIA, nombre);
      } catch (e) {
        if (e instanceof SoundError) {
          sendJson(res, e.status, { error: e.message });
          return;
        }
        throw e;
      }
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': sonido.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      });
      if (metodo === 'HEAD') {
        await sonido.handle.close();
        res.end();
        return;
      }
      pipeline(sonido.handle.createReadStream({ start: 0, end: sonido.size - 1 }), res, () => {});
      return;
    }
    if (pathname === '/api/overview') {
      if (metodo !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'método no permitido' });
        return;
      }
      sendJson(res, 200, await overview());
      return;
    }
    if (pathname === '/api/activity') {
      await activityApi(res, new URL(req.url ?? '/', 'http://127.0.0.1'), metodo);
      return;
    }
    if (pathname === '/api/image') {
      await imageApi(res, new URL(req.url ?? '/', 'http://127.0.0.1'), metodo);
      return;
    }
    if (pathname === '/api/uploads') {
      await uploadsApi(req, res, metodo);
      return;
    }
    if (pathname === '/api/sessions' || pathname.startsWith('/api/sessions/')) {
      await sessionsApi(req, res, pathname, new URL(req.url ?? '/', 'http://127.0.0.1'), metodo);
      return;
    }
    sendJson(res, 404, { error: 'no encontrado' });
  }

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const rechazar = () => {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('401: se requiere el token del panel. Abre la URL que imprime bin/panel (con ?token=...).\n');
    };

    if (!isHostAllowed(req.headers.host, puerto)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403: cabecera Host no permitida.\n');
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${puerto}`);

    // ?token= válido: fija la cookie y redirige a la misma URL sin el token,
    // para que no quede en la barra de direcciones ni en el historial.
    const enUrl = url.searchParams.get('token');
    if (enUrl !== null && (req.method === 'GET' || req.method === 'HEAD') && tokensMatch(opts.token, enUrl)) {
      url.searchParams.delete('token');
      res.writeHead(302, {
        'Set-Cookie': sessionCookie(opts.token),
        Location: url.pathname + url.search,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // El navegador pide el manifiesto y los iconos de la PWA sin credenciales
    // (también al instalarla): son archivos estáticos sin datos y se sirven sin token.
    if (esRecursoPublico(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(opts.distDir, url.pathname, res);
      return;
    }

    if (!isAuthorized(req.headers, opts.token)) {
      rechazar();
      return;
    }

    const manejar = url.pathname.startsWith('/api/')
      ? api(req, res, url.pathname)
      : Promise.resolve(
          req.method === 'GET' || req.method === 'HEAD'
            ? serveStatic(opts.distDir, url.pathname, res)
            : sendJson(res, 405, { error: 'método no permitido' }),
        );
    manejar.catch((e: unknown) => {
      console.error('Error atendiendo la petición:', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'error interno' });
      else res.end();
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rechazar = (codigo: string) => {
      socket.write(`HTTP/1.1 ${codigo}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${puerto}`);
    if (!isHostAllowed(req.headers.host, puerto)) return rechazar('403 Forbidden');
    if (!isAuthorized(req.headers, opts.token)) return rechazar('401 Unauthorized');
    if (!isOriginAllowed(req.headers.origin, puerto, extra)) return rechazar('403 Forbidden');
    if (url.pathname === '/ws/events') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clientes.add(ws);
        ws.on('close', () => clientes.delete(ws));
        ws.on('error', () => clientes.delete(ws));
        ws.send(JSON.stringify({ type: 'hello' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: sesiones.list() }));
      });
      return;
    }

    const m = /^\/ws\/term\/([^/]+)$/.exec(url.pathname);
    if (!m) return rechazar('404 Not Found');
    let nombre: string;
    try {
      nombre = decodeURIComponent(m[1]!);
    } catch {
      return rechazar('400 Bad Request');
    }
    if (!isPanelSessionName(nombre)) return rechazar('404 Not Found');
    const cols = intParam(url, 'cols');
    const rows = intParam(url, 'rows');
    if (Number.isNaN(cols) || Number.isNaN(rows)) return rechazar('400 Bad Request');
    terminal(req, socket, head, nombre, clampInt(cols ?? TERM_COLS.def, TERM_COLS), clampInt(rows ?? TERM_ROWS.def, TERM_ROWS)).catch(
      (e: unknown) => {
        console.error('Error abriendo la terminal:', e);
        socket.destroy();
      },
    );
  });

  // Terminal de una sesión: un cliente `tmux attach` dentro de un pty conectado
  // al WebSocket. Cerrar el WebSocket mata ese cliente, no la sesión.
  async function terminal(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    nombre: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const existe = await sessionExists(tmux, nombre);
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!existe) {
        ws.close(CODIGO_SESION_NO_ENCONTRADA, 'sesión no encontrada');
        return;
      }
      terminales.add(ws);
      let pty: IPty;
      try {
        const a = attachCommand(tmux, nombre);
        pty = spawn(a.file, a.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: opts.harnessRoot,
          env: a.env as Record<string, string>,
          encoding: null, // salida en bruto: el cliente decodifica UTF-8 sin cortar caracteres
        });
      } catch (e) {
        console.error('No se pudo adjuntar a tmux:', e);
        terminales.delete(ws);
        ws.close(1011, 'no se pudo abrir la terminal');
        return;
      }
      let pausado = false;
      pty.onData((datos: string | Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(datos, { binary: true }, () => {
          if (pausado && ws.bufferedAmount < TERM_BACKPRESSURE / 4) {
            pausado = false;
            pty.resume();
          }
        });
        if (!pausado && ws.bufferedAmount > TERM_BACKPRESSURE) {
          pausado = true;
          pty.pause();
        }
      });
      pty.onExit(() => {
        terminales.delete(ws);
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'terminal cerrada');
      });
      // Las escrituras van en cadena: si hay que salir de copy-mode, lo que se
      // teclea mientras tanto no adelanta a la tecla que espera.
      let cola: Promise<void> = Promise.resolve();
      const escribir = (entrada: string | Buffer) => {
        // latin1: un byte por carácter, para reconocer secuencias sin decodificar UTF-8.
        const tipo = classifyCopyModeInput(typeof entrada === 'string' ? entrada : entrada.toString('latin1'));
        if (tipo === 'enter') posibleCopyMode.add(nombre);
        if (tipo === 'type' && posibleCopyMode.has(nombre)) {
          posibleCopyMode.delete(nombre);
          cola = cola.then(() =>
            leaveCopyMode(tmux, nombre).catch((e: unknown) => console.error('No se pudo salir de copy-mode:', e)),
          );
        }
        cola = cola.then(() => {
          try {
            pty.write(entrada);
          } catch {
            // El pty ya se cerró.
          }
        });
      };
      ws.on('message', (datos: Buffer, binario: boolean) => {
        if (!binario) {
          const texto = datos.toString('utf8');
          // Único mensaje de control: {"type":"resize","cols":N,"rows":N}.
          if (texto.startsWith('{')) {
            try {
              const c = JSON.parse(texto) as { type?: unknown; cols?: unknown; rows?: unknown };
              if (c.type === 'resize') {
                if (Number.isInteger(c.cols) && Number.isInteger(c.rows)) {
                  pty.resize(clampInt(c.cols as number, TERM_COLS), clampInt(c.rows as number, TERM_ROWS));
                }
                return;
              }
            } catch {
              // No es JSON: es entrada normal.
            }
          }
          escribir(texto);
          return;
        }
        escribir(datos);
      });
      const cerrar = () => {
        terminales.delete(ws);
        try {
          pty.kill();
        } catch {
          // Ya había terminado.
        }
      };
      ws.on('close', cerrar);
      ws.on('error', cerrar);
    });
  }

  void sesiones.start();
  void vigilanteBacklog.start();
  void vigilanteHistorial.start();
  if (opts.indexActivityAtStart && readSettings(opts.configDir).inicio.activity) actividad.start();

  return new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', ko);
      const direccion = server.address();
      puerto = typeof direccion === 'object' && direccion ? direccion.port : opts.port;
      ok({
        server,
        port: puerto,
        broadcast,
        close: () =>
          new Promise<void>((fin) => {
            sesiones.stop();
            vigilanteBacklog.stop();
            vigilanteHistorial.stop();
            detenerLimpieza();
            actividad.stop();
            for (const c of clientes) c.terminate();
            for (const c of terminales) c.terminate();
            wss.close();
            server.close(() => fin());
            server.closeAllConnections();
          }),
      });
    });
  });
}

function parsePort(valor: string | undefined, origen: string): number | undefined {
  if (valor === undefined || valor === '') return undefined;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`Error: puerto no válido en ${origen}: ${valor}`);
    process.exit(2);
  }
  return n;
}

function parseArgs(argv: string[]): { port?: number; regenerateToken: boolean; printUrl: boolean } {
  let port: number | undefined;
  let regenerar = false;
  let printUrl = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') port = parsePort(argv[++i], '--port');
    else if (a.startsWith('--port=')) port = parsePort(a.slice(7), '--port');
    else if (a === '--regenerate-token') regenerar = true;
    // Solo imprime la URL de acceso, sin escuchar; lo usa bin/panel --open.
    else if (a === '--print-url') printUrl = true;
    else {
      console.error(`Error: opción desconocida: ${a}`);
      process.exit(2);
    }
  }
  return { port, regenerateToken: regenerar, printUrl };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = configDir();
  const harnessRoot = resolve(import.meta.dirname, '..', '..');
  // Prioridad del puerto: argumento, variable de entorno, ajuste y valor por defecto.
  const ajustes = readSettings(dir);
  const port = args.port ?? parsePort(process.env.JDEV_PANEL_PORT, 'JDEV_PANEL_PORT') ?? ajustes.port ?? DEFAULT_PORT;
  const token = args.regenerateToken ? regenerateToken(dir) : loadOrCreateToken(dir);
  if (args.printUrl) {
    console.log(`http://localhost:${port}/?token=${token}`);
    return;
  }
  const extraOrigins = (process.env.JDEV_PANEL_DEV_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');

  const corriendo = await startServer({
    harnessRoot,
    port,
    token,
    distDir: join(harnessRoot, 'panel', 'dist'),
    configDir: dir,
    extraOrigins,
    indexActivityAtStart: true,
  });

  if (args.regenerateToken) console.log('Token regenerado.');
  console.log(`Panel gráfico escuchando en http://127.0.0.1:${corriendo.port}`);
  console.log(`Abre: http://localhost:${corriendo.port}/?token=${token}`);

  const parar = () => {
    corriendo.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    const codigo = (e as NodeJS.ErrnoException).code;
    console.error(
      codigo === 'EADDRINUSE'
        ? 'Error: el puerto ya está en uso; elige otro con --port.'
        : `Error: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  });
}
