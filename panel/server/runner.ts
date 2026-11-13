import { resolveRun } from './devrun.ts';
import type { Project } from './projects.ts';
import { SHELL_AGENT } from './sessions.ts';
import type { SessionInfo, SessionService } from './sessions.ts';
import { SessionInputError, TmuxError, loginShellName, paneCommand, planSession, sendInterrupt, typeLine } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

// Terminal de arranque de un proyecto: arrancarla y pararla.

/** Error de arrancar o parar con el estado HTTP que le corresponde. */
export class RunError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RunError';
    this.status = status;
  }
}

/** Espera máxima a que el proceso responda a Ctrl+C antes de terminar la sesión. */
export const STOP_WAIT_MS = 5000;
const STOP_POLL_MS = 150;

/** Título de la terminal de arranque: su comando, que la distingue de las conversaciones del proyecto. */
export const runTitle = (comando: string): string => comando;

/** Terminal de arranque viva de un proyecto: la que lleva `run` y no ha terminado. */
export function runSessionOf(lista: readonly SessionInfo[], proyecto: string): SessionInfo | undefined {
  return lista.find((s) => s.project === proyecto && s.agent === SHELL_AGENT && s.run !== null && s.alive && s.state !== 'ended');
}

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export type RunControllerOptions = {
  sessions: SessionService;
  tmux: TmuxConfig;
  harnessRoot: string;
  /** Ajustes de proyecto vigentes (se leen en cada petición: el comando propio puede haber cambiado). */
  overrides: () => Record<string, { run?: string }>;
  /** Líneas de historial de tmux para la sesión nueva. */
  historyLimit: () => number;
  /** Espera a Ctrl+C; por defecto, 5 s. */
  stopWaitMs?: number;
};

/**
 * Terminal de arranque de cada proyecto: una sesión `shell` en su carpeta
 * principal que ejecuta el comando de arranque. Las peticiones de un mismo
 * proyecto se atienden de una en una, para que dos clics seguidos no creen dos.
 */
export class RunController {
  private readonly opts: RunControllerOptions;
  private readonly colas = new Map<string, Promise<unknown>>();

  constructor(opts: RunControllerOptions) {
    this.opts = opts;
  }

  private enCola<T>(proyecto: string, tarea: () => Promise<T>): Promise<T> {
    const previa = this.colas.get(proyecto) ?? Promise.resolve();
    const actual = previa.then(tarea, tarea);
    const marca = actual.catch(() => {});
    this.colas.set(proyecto, marca);
    void marca.then(() => {
      if (this.colas.get(proyecto) === marca) this.colas.delete(proyecto);
    });
    return actual;
  }

  /** Arranca el proyecto, o devuelve su terminal de arranque si ya está viva. */
  start(proyecto: Project): Promise<{ session: SessionInfo; created: boolean }> {
    return this.enCola(proyecto.id, async () => {
      const { sessions, tmux } = this.opts;
      const existente = runSessionOf(await sessions.refresh(), proyecto.id);
      if (existente) return { session: existente, created: false };

      const run = await resolveRun(proyecto.path, this.opts.overrides()[proyecto.id]?.run);
      if (run.command === null) {
        throw new RunError(409, 'El proyecto no tiene comando de arranque: configúralo en Ajustes › Proyectos.');
      }
      let plan;
      try {
        plan = planSession({ project: proyecto.id, agent: 'shell', location: 'main' }, [proyecto], this.opts.harnessRoot);
      } catch (e) {
        if (e instanceof SessionInputError) throw new RunError(400, e.message);
        throw e;
      }
      const sesion = await sessions.create(plan, {
        historyLimit: this.opts.historyLimit(),
        run: run.command,
        title: runTitle(run.command),
      });
      try {
        // Se escribe en la shell ya creada: el comando queda en su historial.
        if (!(await typeLine(tmux, sesion.name, run.command))) throw new Error('la sesión ya no existe');
      } catch (e) {
        // Una terminal sin comando no es una terminal de arranque: no se deja.
        await sessions.kill(sesion.name).catch(() => {});
        throw e;
      }
      return { session: sesion, created: true };
    });
  }

  /**
   * Para el proyecto: Ctrl+C, espera a que la shell recupere el primer plano
   * y termina la sesión, haya salido el proceso o no. `graceful` indica si
   * respondió a Ctrl+C a tiempo. Sin terminal de arranque viva no hace nada.
   */
  stop(proyecto: Project): Promise<{ stopped: boolean; graceful: boolean }> {
    return this.enCola(proyecto.id, async () => {
      const { sessions, tmux } = this.opts;
      const sesion = runSessionOf(await sessions.refresh(), proyecto.id);
      if (!sesion) return { stopped: false, graceful: false };

      let graceful = false;
      try {
        if (await sendInterrupt(tmux, sesion.name)) {
          const shell = loginShellName();
          const limite = Date.now() + (this.opts.stopWaitMs ?? STOP_WAIT_MS);
          for (;;) {
            await esperar(STOP_POLL_MS);
            const comando = await paneCommand(tmux, sesion.name);
            if (comando === null || comando === shell) {
              graceful = true;
              break;
            }
            if (Date.now() >= limite) break;
          }
        }
      } catch (e) {
        // Un fallo de tmux al interrumpir no impide terminar: parar es que no quede nada en marcha.
        if (!(e instanceof TmuxError)) throw e;
      } finally {
        await sessions.kill(sesion.name);
      }
      return { stopped: true, graceful };
    });
  }
}
