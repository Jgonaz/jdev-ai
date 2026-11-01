import { CheckRow, IntegerField, SelectField } from '../../components/controls.tsx';
import { useSettings } from '../../state/SettingsContext.tsx';
import type { Settings } from '../../types.ts';

const CURSORES = [
  { value: 'bloque', label: 'Bloque ▌' },
  { value: 'barra', label: 'Barra │' },
  { value: 'subrayado', label: 'Subrayado _' },
] as const;

const DISTRIBUCIONES = [
  { value: '2', label: 'Dos columnas' },
  { value: '1', label: 'Una terminal' },
  { value: '4', label: 'Cuadrícula de cuatro' },
  { value: 'last', label: 'La última usada' },
] as const;

export function TerminalSection() {
  const { settings, update } = useSettings();
  const t = settings.terminal;

  return (
    <section id="terminal" className="set-section" aria-labelledby="h-term">
      <h2 id="h-term" className="set-h2">
        Terminal
      </h2>
      <div className="grid3">
        <SelectField label="Cursor" value={t.cursor} options={CURSORES} onChange={(v) => update({ terminal: { cursor: v } })} />
        <SelectField
          label="Distribución al abrir"
          value={String(t.initialLayout)}
          options={DISTRIBUCIONES}
          onChange={(v) => update({ terminal: { initialLayout: (v === 'last' ? 'last' : Number(v)) as Settings['terminal']['initialLayout'] } })}
        />
        <IntegerField
          id="scrollback"
          label="Historial de scroll (líneas)"
          value={t.scrollback}
          min={100}
          max={100000}
          step={100}
          note="Entre 100 y 100 000 líneas. El historial de tmux de las sesiones ya creadas no cambia."
          onCommit={(v) => update({ terminal: { scrollback: v } })}
        />
      </div>
      <div className="check-list">
        <CheckRow
          label="Copiar al seleccionar"
          hint="Con tmux, mantén Mayús al arrastrar para que el navegador haga la selección."
          checked={t.copyOnSelect}
          onChange={(v) => update({ terminal: { copyOnSelect: v } })}
        />
        <CheckRow label="Mostrar la barra de estado estilo tmux" checked={t.tmuxBar} onChange={(v) => update({ terminal: { tmuxBar: v } })} />
        <CheckRow
          label="Vista previa al pasar el ratón"
          hint="Muestra una miniatura con el nombre y las dimensiones al pasar el ratón por una ruta de imagen."
          checked={t.hoverPreview}
          onChange={(v) => update({ terminal: { hoverPreview: v } })}
        />
        <CheckRow
          label="Abrir el visor al aparecer una imagen nueva"
          hint="Cuando una terminal visible escribe la ruta de una imagen que no estaba en su tira, abre el visor sin quitar el foco de la terminal."
          checked={t.autoOpenImages}
          onChange={(v) => update({ terminal: { autoOpenImages: v } })}
        />
      </div>
      <p className="hint">Las sesiones viven en tmux y siguen vivas al cerrar el panel; terminar una es una acción explícita del menú de su terminal.</p>
    </section>
  );
}
