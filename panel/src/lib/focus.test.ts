// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { terminalMayTakeFocus } from './focus.ts';

describe('terminalMayTakeFocus', () => {
  it('permite tomar el foco cuando no hay nada enfocado o está en el cuerpo', () => {
    expect(terminalMayTakeFocus(null)).toBe(true);
    expect(terminalMayTakeFocus(document.body)).toBe(true);
  });

  it('permite tomarlo desde otra terminal', () => {
    document.body.innerHTML = '<div class="termbody"><textarea id="t"></textarea></div>';
    expect(terminalMayTakeFocus(document.getElementById('t'))).toBe(true);
  });

  it('respeta el foco en una pestaña o un botón', () => {
    document.body.innerHTML = '<button role="tab" id="p"></button><button id="b"></button>';
    expect(terminalMayTakeFocus(document.getElementById('p'))).toBe(false);
    expect(terminalMayTakeFocus(document.getElementById('b'))).toBe(false);
  });
});
