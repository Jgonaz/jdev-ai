import { describe, expect, it } from 'vitest';
import type { AccountLimits, SessionInfo } from '../types.ts';
import {
  artifactLabel,
  artifactsLabel,
  contextView,
  formatAgo,
  formatClock,
  formatDuration,
  formatElapsed,
  formatPercent,
  formatReset,
  formatTokens,
  formatTokensFull,
  hasWork,
  headerView,
  isArtifactUrl,
  isStale,
  levelOf,
  limitView,
  limitsView,
  parseAccount,
  placeText,
  placeTitle,
  shellsLabel,
  shortEffort,
  subagentsLabel,
  workCounts,
} from './statusline.ts';

const MIN = 60_000;
const HORA = 60 * MIN;

function sesion(parche: Partial<SessionInfo> = {}): SessionInfo {
  return {
    name: 'jdev-fitnessia-1',
    project: 'fitnessia',
    agent: 'claude',
    worktree: '',
    branch: 'main',
    state: 'idle',
    tracked: true,
    title: 'Título',
    done: null,
    conversationKey: 'tmux-jdev-x-1-1',
    alive: true,
    updatedAt: 0,
    created: 0,
    notice: '',
    usage: null,
    activity: null,
    archived: false,
    run: null,
    chat: { available: false, reason: null },
    ...parche,
  };
}

const uso = (extra: Partial<NonNullable<SessionInfo['usage']>> = {}): NonNullable<SessionInfo['usage']> => ({
  model: 'Opus 5.5',
  effort: 'medium',
  context: { used: 194000, size: 1000000, percent: 19 },
  worktree: null,
  updatedAt: 1_000_000,
  ...extra,
});

describe('levelOf', () => {
  it('neutro por debajo del 50 %, aviso desde el 50 % y crítico desde el 80 %', () => {
    expect(levelOf(null)).toBe('neutral');
    expect(levelOf(0)).toBe('neutral');
    expect(levelOf(49)).toBe('neutral');
    expect(levelOf(50)).toBe('warn');
    expect(levelOf(79)).toBe('warn');
    expect(levelOf(80)).toBe('critical');
    expect(levelOf(100)).toBe('critical');
  });

  it('se decide con el valor que se muestra: 49,6 % se ve «50 %» y es ámbar; 79,6 %, «80 %» y rojo', () => {
    expect(levelOf(49.4)).toBe('neutral');
    expect(levelOf(49.6)).toBe('warn');
    expect(levelOf(79.4)).toBe('warn');
    expect(levelOf(79.6)).toBe('critical');
    for (const p of [49.4, 49.6, 79.4, 79.6]) {
      const mostrado = Math.round(parseFloat(formatPercent(p)));
      expect(levelOf(p)).toBe(levelOf(mostrado));
    }
  });

  it('la barra de contexto y los límites usan el mismo valor redondeado', () => {
    const ctx = (percent: number) => contextView({ usage: { model: 'x', effort: null, context: { used: null, size: null, percent }, worktree: null, updatedAt: 0 } });
    expect(ctx(49.6)).toMatchObject({ text: formatPercent(49.6), level: 'warn' });
    expect(ctx(49.4)).toMatchObject({ level: 'neutral' });
    expect(ctx(79.6)).toMatchObject({ text: formatPercent(79.6), level: 'critical' });
    expect(ctx(79.4)).toMatchObject({ level: 'warn' });
    expect(limitView({ percent: 49.6, resetsAt: null }, 0)).toMatchObject({ text: formatPercent(49.6), level: 'warn' });
    expect(limitView({ percent: 79.6, resetsAt: null }, 0)).toMatchObject({ level: 'critical' });
    expect(limitView({ percent: 79.4, resetsAt: null }, 0)).toMatchObject({ level: 'warn' });
    expect(limitView({ percent: 49.4, resetsAt: null }, 0)).toMatchObject({ level: 'neutral' });
  });
});

describe('isStale', () => {
  it('solo si lleva más de 15 min sin cambiar y la sesión no está trabajando', () => {
    expect(isStale(0, 15 * MIN, false)).toBe(false);
    expect(isStale(0, 15 * MIN + 1, false)).toBe(true);
    expect(isStale(0, 60 * MIN, true)).toBe(false);
  });
});

describe('formatos de tiempo', () => {
  it('formatAgo', () => {
    expect(formatAgo(0, 12_000)).toBe('hace 12 s');
    expect(formatAgo(0, 20 * MIN)).toBe('hace 20 min');
    expect(formatAgo(0, 3 * HORA)).toBe('hace 3 h');
    expect(formatAgo(0, 50 * HORA)).toBe('hace 2 d');
    expect(formatAgo(10_000, 0)).toBe('hace 0 s');
  });

  it('formatDuration', () => {
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(48 * MIN)).toBe('48 min');
    expect(formatDuration(2 * HORA + 14 * MIN)).toBe('2 h 14 min');
    expect(formatDuration(3 * HORA + 5 * MIN)).toBe('3 h 05 min');
    expect(formatDuration(27 * HORA)).toBe('1 d 3 h');
    expect(formatDuration(-5)).toBe('< 1 min');
  });

  it('formatElapsed', () => {
    expect(formatElapsed(22_000)).toBe('22 s');
    expect(formatElapsed(72_000)).toBe('1 m 12 s');
    expect(formatElapsed(4 * MIN)).toBe('4 m');
    expect(formatElapsed(25 * MIN + 40_000)).toBe('25 m');
    expect(formatElapsed(HORA + 5 * MIN)).toBe('1 h 05 min');
  });
});

describe('formatos de cifras', () => {
  it('formatTokens', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(194_000)).toBe('194k');
    expect(formatTokens(570_000)).toBe('570k');
    expect(formatTokens(1_000_000)).toBe('1,0M');
    expect(formatTokens(1_250_000)).toBe('1,3M');
  });

  it('formatTokensFull y formatPercent usan espacio duro', () => {
    expect(formatTokensFull(194000)).toBe('194 000');
    expect(formatTokensFull(1_000_000)).toBe('1 000 000');
    expect(formatPercent(18.6)).toBe('19 %');
  });

  it('shortEffort abrevia solo medium', () => {
    expect(shortEffort('medium')).toBe('med');
    expect(shortEffort('xhigh')).toBe('xhigh');
  });
});

describe('formatClock', () => {
  it('hora local con dos cifras', () => {
    expect(formatClock(new Date(2026, 10, 2, 9, 5).getTime())).toBe('09:05');
    expect(formatClock(new Date(2026, 10, 2, 14, 2).getTime())).toBe('14:02');
  });
});

describe('formatReset', () => {
  // Fechas locales: la prueba no depende de la zona horaria.
  const ahora = new Date(2026, 10, 2, 17, 0).getTime(); // lunes 2 nov 2026, 17:00

  it('hoy, mañana, día de la semana y fecha', () => {
    expect(formatReset(new Date(2026, 10, 2, 21, 20).getTime(), ahora)).toBe('hoy a las 21:20');
    expect(formatReset(new Date(2026, 10, 3, 5, 0).getTime(), ahora)).toBe('mañana a las 05:00');
    expect(formatReset(new Date(2026, 10, 6, 5, 0).getTime(), ahora)).toBe('el viernes a las 05:00');
    expect(formatReset(new Date(2026, 10, 9, 5, 0).getTime(), ahora)).toBe('el 9 nov a las 05:00');
  });

  it('pasada la medianoche sigue siendo «hoy» hasta que cambia el día', () => {
    expect(formatReset(new Date(2026, 10, 2, 23, 59).getTime(), ahora)).toBe('hoy a las 23:59');
    expect(formatReset(new Date(2026, 10, 2, 8, 0).getTime(), ahora)).toBe('hoy a las 08:00');
  });
});

describe('limitView / limitsView', () => {
  const ahora = new Date(2026, 10, 2, 17, 0).getTime();
  const en = (h: number, m: number, dia = 2) => new Date(2026, 10, dia, h, m).getTime();

  it('porcentaje, nivel y hora de reinicio', () => {
    expect(limitView({ percent: 91, resetsAt: en(21, 20) }, ahora)).toEqual({ percent: 91, level: 'critical', text: '91 %', reset: 'hoy a las 21:20' });
    expect(limitView({ percent: 58, resetsAt: null }, ahora)).toMatchObject({ level: 'warn', reset: '' });
  });

  it('una ventana ya reiniciada no enseña el dato viejo', () => {
    expect(limitView({ percent: 91, resetsAt: en(16, 0) }, ahora)).toEqual({ percent: null, level: 'neutral', text: '—', reset: 'ya se reinició' });
  });

  it('describe las dos ventanas para el botón y toma el peor nivel', () => {
    const cuenta: AccountLimits = { fiveHour: { percent: 91, resetsAt: en(21, 20) }, sevenDay: { percent: 58, resetsAt: en(5, 0, 6) }, updatedAt: ahora };
    const v = limitsView(cuenta, ahora)!;
    expect(v.level).toBe('critical');
    expect(v.fiveHour?.level).toBe('critical');
    expect(v.sevenDay?.level).toBe('warn');
    expect(v.label).toBe('Límites de la cuenta: 5 horas al 91 %, se reinicia hoy a las 21:20; 7 días al 58 %, se reinicia el viernes a las 05:00');
  });

  it('con una sola ventana muestra solo esa, y sin ninguna se oculta', () => {
    const v = limitsView({ fiveHour: { percent: 3, resetsAt: en(21, 20) }, sevenDay: null, updatedAt: ahora }, ahora)!;
    expect(v.sevenDay).toBeNull();
    expect(v.label).toBe('Límites de la cuenta: 5 horas al 3 %, se reinicia hoy a las 21:20');
    expect(limitsView(null, ahora)).toBeNull();
    expect(limitsView({ fiveHour: null, sevenDay: null, updatedAt: ahora }, ahora)).toBeNull();
  });

  it('una ventana reiniciada se describe sin porcentaje', () => {
    const v = limitsView({ fiveHour: { percent: 91, resetsAt: en(16, 0) }, sevenDay: null, updatedAt: ahora }, ahora)!;
    expect(v.label).toBe('Límites de la cuenta: 5 horas sin dato, ya se reinició');
    expect(v.level).toBe('neutral');
  });
});

describe('parseAccount', () => {
  it('lee los límites del servidor y descarta lo que no tiene la forma esperada', () => {
    expect(parseAccount({ fiveHour: { percent: 91, resetsAt: 5 }, sevenDay: null, updatedAt: 10 })).toEqual({
      fiveHour: { percent: 91, resetsAt: 5 },
      sevenDay: null,
      updatedAt: 10,
    });
    expect(parseAccount({ fiveHour: { percent: 140, resetsAt: 'x' }, sevenDay: { percent: 'a' } })).toEqual({
      fiveHour: { percent: 100, resetsAt: null },
      sevenDay: null,
      updatedAt: 0,
    });
    for (const malo of [null, undefined, 3, 'x', {}, { fiveHour: null, sevenDay: null }]) expect(parseAccount(malo)).toBeNull();
  });
});

describe('trabajo en curso', () => {
  it('cuenta y detecta si hay trabajo', () => {
    expect(workCounts(null)).toEqual({ subagents: 0, shells: 0, artifacts: 0 });
    expect(hasWork(workCounts(null))).toBe(false);
    const c = workCounts({ subagents: [{ id: 'a', type: 'qa', since: 1 }], shells: [], artifacts: [{ url: 'u', title: null }] });
    expect(c).toEqual({ subagents: 1, shells: 0, artifacts: 1 });
    expect(hasWork(c)).toBe(true);
  });

  it('etiquetas en singular y plural', () => {
    expect(subagentsLabel(1)).toBe('1 subagente');
    expect(subagentsLabel(3)).toBe('3 subagentes');
    expect(shellsLabel(1)).toBe('1 shell');
    expect(shellsLabel(2)).toBe('2 shells');
    expect(artifactsLabel(1)).toBe('1 artifact');
    expect(artifactsLabel(2)).toBe('2 artifacts');
  });

  it('solo enlaces de artifact de claude.ai', () => {
    expect(isArtifactUrl('https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU')).toBe(true);
    expect(isArtifactUrl('https://claude.ai/code/artifact/0a1b-22')).toBe(true);
    expect(isArtifactUrl('http://claude.ai/artifact/abc')).toBe(false);
    expect(isArtifactUrl('https://claude.ai/artifact/abc?x=1')).toBe(false);
    expect(isArtifactUrl('https://claude.ai.evil.example/artifact/abc')).toBe(false);
    expect(isArtifactUrl('javascript:alert(1)')).toBe(false);
  });

  it('el texto de un artifact es su título o el final del enlace', () => {
    expect(artifactLabel({ url: 'https://claude.ai/artifact/abc', title: 'Plan' })).toBe('Plan');
    expect(artifactLabel({ url: 'https://claude.ai/artifact/abc', title: null })).toBe('artifact/abc');
  });
});

describe('contextView', () => {
  it('sin statusline o sin contexto no hay barra', () => {
    expect(contextView(sesion())).toBeNull();
    expect(contextView(sesion({ usage: uso({ context: null }) }))).toBeNull();
  });

  it('porcentaje, tokens y texto accesible', () => {
    expect(contextView(sesion({ usage: uso() }))).toEqual({
      percent: 19,
      level: 'neutral',
      text: '19 %',
      tokens: '194k/1,0M',
      valueText: '19 %, 194 000 de 1 000 000 tokens',
    });
  });

  it('crítico desde el 80 %', () => {
    const v = contextView(sesion({ usage: uso({ context: { used: 860000, size: 1000000, percent: 86 } }) }));
    expect(v).toMatchObject({ level: 'critical', text: '86 %' });
  });

  it('al principio de la sesión no hay porcentaje ni tokens', () => {
    expect(contextView(sesion({ usage: uso({ context: { used: null, size: 1000000, percent: null } }) }))).toEqual({
      percent: null,
      level: 'neutral',
      text: '—',
      tokens: '',
      valueText: 'sin datos todavía',
    });
  });
});

describe('placeText / placeTitle', () => {
  it('rama, principal y worktree', () => {
    expect(placeText({ worktree: null, branch: 'main' })).toBe('main');
    expect(placeText({ worktree: null, branch: null })).toBe('principal');
    expect(placeText({ worktree: 'ts7', branch: 'feat/ts7' })).toBe('wt ts7 · feat/ts7');
    expect(placeText({ worktree: 'ts7', branch: null })).toBe('wt ts7');
    expect(placeTitle({ worktree: 'ts7', branch: 'feat/ts7' })).toBe('Worktree ts7, rama feat/ts7');
    expect(placeTitle({ worktree: null, branch: 'main' })).toBe('Rama main en el checkout principal');
  });
});

describe('headerView', () => {
  const ahora = 1_000_000 + 3 * MIN;

  it('Claude con datos: modelo y esfuerzo, tiempo de sesión y contexto', () => {
    const v = headerView(sesion({ usage: uso(), created: ahora - (2 * HORA + 14 * MIN) }), ahora);
    expect(v).toMatchObject({
      place: { worktree: null, branch: 'main' },
      model: 'Opus 5.5',
      effort: 'medium',
      elapsed: '2 h 14 min',
      stale: false,
      ago: '',
    });
    expect(v.context?.percent).toBe(19);
  });

  it('sin datos (Codex o Claude recién abierto) muestra el agente, sin contexto ni esfuerzo', () => {
    const v = headerView(sesion({ agent: 'codex', tracked: false, created: ahora - 80 * MIN }), ahora);
    expect(v).toMatchObject({ model: 'codex', effort: null, elapsed: '1 h 20 min', context: null, counts: { subagents: 0, shells: 0, artifacts: 0 } });
  });

  it('en un worktree del panel usa el nombre y la rama de la sesión', () => {
    const v = headerView(sesion({ worktree: 'ts7', branch: 'feat/ts7' }), ahora);
    expect(v.place).toEqual({ worktree: 'ts7', branch: 'feat/ts7' });
  });

  it('si Claude se movió a un worktree que la sesión no conoce, usa el de la statusline', () => {
    const v = headerView(sesion({ usage: uso({ worktree: { name: 'otro', branch: null } }) }), ahora);
    expect(v.place).toEqual({ worktree: 'otro', branch: null });
    // Pero el worktree de la sesión manda si lo tiene.
    const w = headerView(sesion({ worktree: 'ts7', branch: 'feat/ts7', usage: uso({ worktree: { name: 'otro', branch: null } }) }), ahora);
    expect(w.place.worktree).toBe('ts7');
  });

  it('atenuado con «hace N min» solo si no trabaja y lleva más de 15 min sin cambiar', () => {
    const viejo = uso({ updatedAt: ahora - 20 * MIN });
    expect(headerView(sesion({ state: 'idle', usage: viejo }), ahora)).toMatchObject({ stale: true, ago: 'hace 20 min' });
    expect(headerView(sesion({ state: 'working', usage: viejo }), ahora)).toMatchObject({ stale: false, ago: '' });
    expect(headerView(sesion({ state: 'idle', usage: uso({ updatedAt: ahora - 10 * MIN }) }), ahora).stale).toBe(false);
  });

  it('cuenta el trabajo en curso', () => {
    const v = headerView(
      sesion({ activity: { subagents: [{ id: 'a', type: 'qa', since: 1 }, { id: 'b', type: 'Explore', since: 2 }], shells: [{ label: 'pnpm dev' }], artifacts: [] } }),
      ahora,
    );
    expect(v.counts).toEqual({ subagents: 2, shells: 1, artifacts: 0 });
  });
});
