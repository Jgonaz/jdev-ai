import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

type Tab<T extends string> = { value: T; label: string };

/**
 * Lista de pestañas accesible (tablist/tab con foco itinerante y flechas). Cada
 * pestaña se llama
 * `${idBase}-tab-${value}`; la activa controla el panel
 * `${idBase}-panel-${value}` (solo se monta el de la pestaña activa).
 */
export function Tabs<T extends string>(props: {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idBase: string;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const alPulsar = (e: KeyboardEvent) => {
    const i = props.tabs.findIndex((t) => t.value === props.value);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % props.tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + props.tabs.length) % props.tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = props.tabs.length - 1;
    if (j < 0) return;
    e.preventDefault();
    props.onChange(props.tabs[j]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={props.label} className={props.className} onKeyDown={alPulsar}>
      {props.tabs.map((t) => {
        const activa = t.value === props.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${props.idBase}-tab-${t.value}`}
            aria-selected={activa}
            // Solo existe el panel de la pestaña activa: las demás no apuntan a ids inexistentes.
            aria-controls={activa ? `${props.idBase}-panel-${t.value}` : undefined}
            tabIndex={activa ? 0 : -1}
            onClick={() => props.onChange(t.value)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Props del tabpanel que corresponde a una pestaña de `Tabs`. */
export const tabPanelProps = (idBase: string, value: string) => ({
  role: 'tabpanel' as const,
  id: `${idBase}-panel-${value}`,
  'aria-labelledby': `${idBase}-tab-${value}`,
});
