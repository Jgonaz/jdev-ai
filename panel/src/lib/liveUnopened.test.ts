import { describe, expect, it } from 'vitest';
import type { ProjectInfo, SessionInfo } from '../types.ts';
import { LIVE_COLLAPSED_KEY, isLive, liveCountLabel, liveUnopened, loadLiveCollapsed, saveLiveCollapsed } from './liveUnopened.ts';

const proyecto = (id: string, visible = true): ProjectInfo => ({
  id,
  name: id,
  path: `/x/${id}`,
  harness: false,
  branch: 'main',
  worktrees: [],
  mono: 'XX',
  color: '#000',
  visible,
  defaultMono: 'XX',
  defaultColor: '#000',
});

const sesion = (name: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  name,
  project: 'a',
  agent: 'claude',
  worktree: '',
  branch: 'main',
  state: 'idle',
  tracked: true,
  title: name,
  closed: false,
  alive: true,
  updatedAt: 1000,
  created: 0,
  notice: '',
  usage: null,
  activity: null,
  archived: false,
  ...extra,
});

const proyectos = [proyecto('a'), proyecto('oculto', false)];
const nombres = (l: ReturnType<typeof liveUnopened>) => l.map((i) => i.session.name);

describe('isLive', () => {
  it('exige proceso vivo y estado distinto de ended (incluye Codex sin turnos)', () => {
    expect(isLive({ alive: true, state: 'idle' })).toBe(true);
    expect(isLive({ alive: true, state: 'alive' })).toBe(true);
    expect(isLive({ alive: true, state: 'ended' })).toBe(false);
    expect(isLive({ alive: false, state: 'idle' })).toBe(false);
  });
});

describe('liveUnopened', () => {
  it('omite las abiertas en pestañas y las terminadas', () => {
    const l = liveUnopened(
      [sesion('abierta'), sesion('libre'), sesion('muerta', { alive: false }), sesion('fin', { state: 'ended' })],
      proyectos,
      ['abierta'],
    );
    expect(nombres(l)).toEqual(['libre']);
  });

  it('las pestañas de seguimiento no son sesiones: no ocultan a la suya ni aparecen como sesión viva', () => {
    const l = liveUnopened([sesion('jdev-a-1'), sesion('jdev-a-2')], proyectos, ['jdev-a-2', 'follow:jdev-a-1:agent:abc1', 'follow:jdev-a-9:shell:b2']);
    expect(nombres(l)).toEqual(['jdev-a-1']);
  });

  it('ordena por estado y luego por actividad reciente', () => {
    const l = liveUnopened(
      [
        sesion('cerrada', { closed: true, updatedAt: 9000 }),
        sesion('reposo-vieja', { updatedAt: 1000 }),
        sesion('reposo-nueva', { updatedAt: 5000 }),
        sesion('trabaja', { state: 'working', updatedAt: 100 }),
        sesion('espera', { state: 'waiting', updatedAt: 50 }),
        sesion('codex', { agent: 'codex', tracked: false, state: 'alive', updatedAt: 3000 }),
      ],
      proyectos,
      [],
    );
    expect(nombres(l)).toEqual(['espera', 'trabaja', 'reposo-nueva', 'codex', 'reposo-vieja', 'cerrada']);
    expect(l.map((i) => i.state)).toEqual(['waiting', 'working', 'idle', 'alive', 'idle', 'closed']);
  });

  it('omite las archivadas, también las que esperan: tienen su propia sección', () => {
    const l = liveUnopened(
      [sesion('a1', { archived: true }), sesion('a2', { archived: true, state: 'waiting' }), sesion('normal')],
      proyectos,
      [],
    );
    expect(nombres(l)).toEqual(['normal']);
  });

  it('desempata por nombre', () => {
    expect(nombres(liveUnopened([sesion('b'), sesion('a')], proyectos, []))).toEqual(['a', 'b']);
  });

  it('con hideClosed omite las cerradas, pero no las cerradas que esperan', () => {
    const lista = [sesion('c', { closed: true }), sesion('cw', { closed: true, state: 'waiting' }), sesion('n')];
    expect(nombres(liveUnopened(lista, proyectos, [], { hideClosed: true }))).toEqual(['cw', 'n']);
    expect(nombres(liveUnopened(lista, proyectos, []))).toEqual(['cw', 'n', 'c']);
  });

  it('los proyectos ocultos solo aportan las sesiones que esperan, marcadas', () => {
    const l = liveUnopened(
      [
        sesion('o-reposo', { project: 'oculto' }),
        sesion('o-trabaja', { project: 'oculto', state: 'working' }),
        sesion('o-espera', { project: 'oculto', state: 'waiting' }),
      ],
      proyectos,
      [],
    );
    expect(nombres(l)).toEqual(['o-espera']);
    expect(l[0]!.hiddenProject).toBe(true);
    expect(liveUnopened([sesion('x')], proyectos, [])[0]!.hiddenProject).toBe(false);
  });

  it('una sesión de un proyecto desconocido usa un proyecto genérico visible', () => {
    const l = liveUnopened([sesion('x', { project: 'nuevo' })], proyectos, []);
    expect(l[0]!.project.id).toBe('nuevo');
    expect(l[0]!.hiddenProject).toBe(false);
  });

  it('no muta la entrada', () => {
    const entrada = [sesion('b', { updatedAt: 1 }), sesion('a', { updatedAt: 2, state: 'waiting' })];
    liveUnopened(entrada, proyectos, []);
    expect(entrada.map((s) => s.name)).toEqual(['b', 'a']);
  });
});

describe('liveCountLabel', () => {
  it('concuerda en número', () => {
    expect(liveCountLabel(1)).toContain('1 terminal viva');
    expect(liveCountLabel(3)).toContain('3 terminales vivas');
  });
});

describe('plegado recordado', () => {
  const memoria = () => {
    const d = new Map<string, string>();
    return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) };
  };

  it('por defecto está desplegado y recuerda el plegado', () => {
    const s = memoria();
    expect(loadLiveCollapsed(s)).toBe(false);
    saveLiveCollapsed(true, s);
    expect(s.getItem(LIVE_COLLAPSED_KEY)).toBe('1');
    expect(loadLiveCollapsed(s)).toBe(true);
    saveLiveCollapsed(false, s);
    expect(loadLiveCollapsed(s)).toBe(false);
  });

  it('tolera un almacenamiento que lanza o inexistente', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadLiveCollapsed(roto)).toBe(false);
    expect(() => saveLiveCollapsed(true, roto)).not.toThrow();
    expect(loadLiveCollapsed(null)).toBe(false);
    expect(() => saveLiveCollapsed(true, null)).not.toThrow();
  });
});
