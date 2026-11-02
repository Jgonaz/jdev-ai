import { describe, expect, it } from 'vitest';
import type { AgentFollow, ShellFollow } from '../../shared/follow.ts';
import { applyResponse } from './useFollow.ts';
import type { FollowEntry } from './useFollow.ts';
import { EMPTY_AGENT } from './follow.ts';

const vacia = (kind: 'agent' | 'shell'): FollowEntry => ({ kind, state: null, meta: null, agent: EMPTY_AGENT, shell: '', from: null, lastOk: null, error: 'antes', failures: 2, version: 0 });

describe('applyResponse', () => {
  it('suma lo de un subagente, guarda el byte siguiente y borra el error', () => {
    const r: AgentFollow = {
      kind: 'agent',
      state: 'running',
      from: 120,
      reset: false,
      more: false,
      meta: { description: 'Ajustar el input', agentType: 'implementer', startedAt: 5, updatedAt: 9 },
      events: [{ type: 'task', text: 'Haz X' }, { type: 'tool', id: 't1', tool: 'Read', verb: 'Leo', target: 'a.ts', at: 1 }],
    };
    const e = applyResponse(vacia('agent'), r, 1000);
    expect(e).toMatchObject({ state: 'running', from: 120, lastOk: 1000, error: null, failures: 0, version: 1, meta: { description: 'Ajustar el input', agentType: 'implementer' } });
    expect(e.agent.toolCount).toBe(1);
    // La siguiente respuesta suma sobre lo anterior; con reset lo descarta.
    const e2 = applyResponse(e, { ...r, from: 200, events: [{ type: 'result', id: 't1', error: false, summary: 'ok', lines: 2 }] }, 2000);
    expect(e2.agent.steps[0]).toMatchObject({ result: { lines: 2 } });
    expect(applyResponse(e2, { ...r, reset: true, events: [] }, 3000).agent.steps).toEqual([]);
  });

  it('suma la salida de una shell y reset la sustituye', () => {
    const r: ShellFollow = { kind: 'shell', state: 'finished', from: 6, reset: false, more: false, meta: { command: 'pnpm dev', startedAt: 1, updatedAt: 2 }, text: 'hola\n' };
    const e = applyResponse(vacia('shell'), r, 10);
    expect(e).toMatchObject({ shell: 'hola\n', state: 'finished', meta: { command: 'pnpm dev' } });
    expect(applyResponse(e, { ...r, from: 12, text: 'mundo\n' }, 11).shell).toBe('hola\nmundo\n');
    expect(applyResponse(e, { ...r, reset: true, text: 'otra\n' }, 12).shell).toBe('otra\n');
  });
});
