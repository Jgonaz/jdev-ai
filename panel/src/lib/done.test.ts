import { describe, expect, it } from 'vitest';
import { doneBy, doneLine, doneWhen } from './done.ts';

const AHORA = Date.parse('2026-11-06T10:00:00Z');

describe('doneWhen', () => {
  it('da el día y la hora locales, sin año si es el actual', () => {
    expect(doneWhen('2026-11-05T15:20:00Z', AHORA, 'UTC')).toBe('5 nov a las 15:20');
    expect(doneWhen('2026-11-05T15:20:00Z', AHORA, 'Europe/Madrid')).toBe('5 nov a las 16:20');
  });

  it('añade el año si es de otro año', () => {
    expect(doneWhen('2025-12-31T23:59:00Z', AHORA, 'UTC')).toBe('31 dic 2025 a las 23:59');
  });

  it('una fecha ilegible no da texto', () => {
    expect(doneWhen('ayer', AHORA, 'UTC')).toBeNull();
  });
});

describe('doneLine', () => {
  it('dice quién la marcó', () => {
    expect(doneBy('user')).toBe('por ti');
    expect(doneBy('agent')).toBe('por el agente');
    expect(doneLine({ at: '2026-11-05T15:20:00Z', by: 'user', note: null }, AHORA, 'UTC')).toBe('Hecha el 5 nov a las 15:20 · por ti');
    expect(doneLine({ at: '2026-11-05T15:20:00Z', by: 'agent', note: 'x' }, AHORA, 'UTC')).toBe('Hecha el 5 nov a las 15:20 · por el agente');
  });

  it('sin fecha (marca antigua del título) o con fecha ilegible no la inventa', () => {
    expect(doneLine({ at: null, by: 'agent', note: null }, AHORA)).toBe('Hecha · por el agente');
    expect(doneLine({ at: 'no', by: 'user', note: null }, AHORA)).toBe('Hecha · por ti');
  });
});
