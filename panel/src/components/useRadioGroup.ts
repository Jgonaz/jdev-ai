import type { KeyboardEvent } from 'react';
import { nextRadioIndex } from '../lib/radio.ts';

type Opcion<T extends string> = { value: T; disabled?: boolean };

/**
 * Atributos de un grupo de radios accesible (role=radiogroup + role=radio,
 * aria-checked, un solo tabstop y flechas) sobre botones con el aspecto
 * que ya tenían, sin cambiar el marcado visual.
 */
export function useRadioGroup<T extends string>(opciones: readonly Opcion<T>[], valor: T, alElegir: (v: T) => void) {
  const alPulsar = (e: KeyboardEvent<HTMLElement>) => {
    // Solo las teclas que llegan desde un radio: el campo de feature o el select del grupo conservan las suyas.
    if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'radio') return;
    const actual = opciones.findIndex((o) => o.value === valor);
    const destino = nextRadioIndex(
      e.key,
      actual,
      opciones.map((o) => o.disabled === true),
    );
    if (destino === null) return;
    e.preventDefault();
    const elegida = opciones[destino]!;
    alElegir(elegida.value);
    // Los radios van en el orden de las opciones; el foco sigue a la selección.
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[destino]?.focus();
  };
  return {
    groupProps: { role: 'radiogroup' as const, onKeyDown: alPulsar },
    radioProps: (o: Opcion<T>) => ({
      role: 'radio' as const,
      'aria-checked': o.value === valor,
      tabIndex: o.value === valor ? 0 : -1,
      disabled: o.disabled,
      onClick: () => alElegir(o.value),
    }),
  };
}
