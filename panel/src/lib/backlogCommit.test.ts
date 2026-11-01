import { describe, expect, it } from 'vitest';
import { commitOutcome, fileChangeLabel, loadPushPreference, phaseLabel, pushTargetNote, savePushPreference } from './backlogCommit.ts';

describe('diálogo «Confirmar cambios»', () => {
  it('recuerda la casilla de push, marcada por defecto, y tolera un almacenamiento que lanza', () => {
    const mapa = new Map<string, string>();
    const almacen = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v) };
    expect(loadPushPreference(almacen)).toBe(true);
    savePushPreference(false, almacen);
    expect(loadPushPreference(almacen)).toBe(false);
    savePushPreference(true, almacen);
    expect(loadPushPreference(almacen)).toBe(true);
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadPushPreference(roto)).toBe(true);
    expect(() => savePushPreference(false, roto)).not.toThrow();
    expect(loadPushPreference(null)).toBe(true);
  });

  it('describe el cambio de cada archivo', () => {
    const a = 'BL-20261024-1145-a.md';
    expect(fileChangeLabel({ status: 'moved', path: `docs/backlog/todo/${a}`, from: `docs/backlog/backlog/${a}` })).toBe('movido desde backlog a todo');
    expect(fileChangeLabel({ status: 'moved', path: `docs/backlog/todo/${a}`, from: 'docs/backlog/todo/viejo.md' })).toBe(
      'renombrado desde docs/backlog/todo/viejo.md',
    );
    expect(fileChangeLabel({ status: 'modified', path: 'x' })).toBe('modificado');
    expect(fileChangeLabel({ status: 'added', path: 'x' })).toBe('añadido');
    expect(fileChangeLabel({ status: 'deleted', path: 'x' })).toBe('eliminado');
  });

  it('avisa de dónde se creará la rama', () => {
    expect(pushTargetNote({ detached: false, upstream: null, remote: 'origin' })).toBe('Se creará la rama en origin.');
    expect(pushTargetNote({ detached: false, upstream: 'origin/main', remote: 'origin' })).toBeNull();
    expect(pushTargetNote({ detached: false, upstream: null, remote: null })).toContain('no tiene remoto');
    expect(pushTargetNote({ detached: true, upstream: null, remote: 'origin' })).toBeNull();
  });

  it('progreso por fases y resultado', () => {
    expect(phaseLabel(null)).toBe('Haciendo commit…');
    expect(phaseLabel('commit')).toBe('Haciendo commit…');
    expect(phaseLabel('push')).toBe('Subiendo…');
    expect(commitOutcome({ kind: 'ok', commit: 'abc1234', pushed: true, output: '' })).toEqual({
      tone: 'ok',
      text: 'Commit abc1234 hecho y subido.',
      output: '',
      done: true,
    });
    expect(commitOutcome({ kind: 'ok', commit: 'abc1234', pushed: false, output: '' }).text).toBe('Commit abc1234 hecho en local.');
    expect(commitOutcome({ kind: 'push-failed', commit: 'abc1234', error: 'x', output: 'rechazado' })).toEqual({
      tone: 'warning',
      text: 'Commit abc1234 hecho en local; el push falló.',
      output: 'rechazado',
      done: true,
    });
    expect(commitOutcome({ kind: 'failed', status: 422, error: 'El commit ha fallado; no se ha creado.', output: 'lint' })).toEqual({
      tone: 'error',
      text: 'El commit ha fallado; no se ha creado.',
      output: 'lint',
      done: false,
    });
  });
});
