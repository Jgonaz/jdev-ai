import { describe, expect, it } from 'vitest';
import { decodeOsc52 } from './osc52.ts';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('decodeOsc52', () => {
  it('decodifica la escritura de tmux, con UTF-8', () => {
    expect(decodeOsc52(`c;${b64('hola')}`)).toBe('hola');
    expect(decodeOsc52(`;${b64('año ✓\nlínea')}`)).toBe('año ✓\nlínea');
  });

  it('ignora consultas, vacíos y basura', () => {
    expect(decodeOsc52('c;?')).toBeNull();
    expect(decodeOsc52('c;')).toBeNull();
    expect(decodeOsc52('sin-separador')).toBeNull();
    expect(decodeOsc52('c;%%%')).toBeNull();
    expect(decodeOsc52(`c;${btoa('\xff\xfe')}`)).toBeNull();
  });
});
