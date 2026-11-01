import { RangeField, SelectField } from '../../components/controls.tsx';
import { TERMINAL_FONTS, TITLE_FONTS, UI_FONTS } from '../../lib/theme.ts';
import type { FontOption } from '../../lib/theme.ts';
import { useSettings } from '../../state/SettingsContext.tsx';

// Si el archivo de ajustes trae una fuente a mano que no está en la lista, se conserva como opción.
function conActual(opciones: readonly FontOption[], actual: string): FontOption[] {
  return opciones.some((o) => o.value === actual) ? [...opciones] : [...opciones, { label: 'Personalizada', value: actual }];
}

export function Typography() {
  const { settings, update } = useSettings();
  return (
    <section id="tipografia" className="set-section" aria-labelledby="h-tipo">
      <h2 id="h-tipo" className="set-h2">
        Tipografía
      </h2>
      <div className="grid3">
        <SelectField label="Interfaz" value={settings.fonts.ui} options={conActual(UI_FONTS, settings.fonts.ui)} onChange={(v) => update({ fonts: { ui: v } })} />
        <SelectField
          label="Títulos y etiquetas"
          value={settings.fonts.title}
          options={conActual(TITLE_FONTS, settings.fonts.title)}
          onChange={(v) => update({ fonts: { title: v } })}
        />
        <SelectField
          label="Terminal"
          value={settings.fonts.terminal}
          options={conActual(TERMINAL_FONTS, settings.fonts.terminal)}
          onChange={(v) => update({ fonts: { terminal: v } })}
        />
      </div>
      <div className="grid2">
        <RangeField label="Tamaño de la interfaz" min={12} max={18} step={1} value={settings.sizes.ui} onChange={(v) => update({ sizes: { ui: v } })} />
        <RangeField
          label="Tamaño de la terminal"
          min={10}
          max={18}
          step={0.5}
          value={settings.sizes.terminal}
          onChange={(v) => update({ sizes: { terminal: v } })}
        />
      </div>
      <div className="type-preview" aria-label="Vista previa de la terminal">
        <span className="type-preview__prompt">&gt;</span> Vista previa: <span className="type-preview__ok">●</span> Edito Modal.tsx{' '}
        <span className="type-preview__dim">(+12 −4)</span> =&gt; != === 0O1lI
      </div>
    </section>
  );
}
