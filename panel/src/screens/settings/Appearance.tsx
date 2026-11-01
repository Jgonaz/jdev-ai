import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { ACCENT_CARDS, THEME_CARDS } from '../../lib/theme.ts';
import { profileNameInput } from '../../lib/validation.ts';
import { useSettings } from '../../state/SettingsContext.tsx';
import { CheckRow, SelectField, SwitchRow } from '../../components/controls.tsx';
import type { Settings } from '../../types.ts';

const START_OPTIONS: readonly { value: Settings['startScreen']; label: string }[] = [
  { value: 'inicio', label: 'Inicio' },
  { value: 'terminales', label: 'Terminales' },
];

/** «Tu nombre» y «Pantalla al abrir». */
function InicioFields() {
  const { settings, loaded, update } = useSettings();
  const guardado = settings.profile.name;
  const [texto, setTexto] = useState(guardado);
  const [gitName, setGitName] = useState<string | null>(null);
  // Sin `maxLength` nativo: cuenta unidades UTF-16 y un emoji contaría doble.
  const { error } = profileNameInput(texto);

  // Lo guardado manda salvo mientras se escribe (lo escrito, sin espacios sobrantes, ya coincide).
  useEffect(() => {
    setTexto((t) => (t.trim() === guardado ? t : guardado));
  }, [guardado, loaded]);
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .overview(ctrl.signal)
      .then((o) => setGitName(o.gitName))
      .catch(() => {
        // Sin nombre de Git, el campo queda sin sugerencia.
      });
    return () => ctrl.abort();
  }, []);

  return (
    <fieldset className="fieldset">
      <legend className="set-legend">Inicio</legend>
      <div className="grid2">
        <div className="field">
          <label htmlFor="ajuste-nombre">Tu nombre</label>
          <input
            id="ajuste-nombre"
            className="input"
            type="text"
            autoComplete="given-name"
            value={texto}
            placeholder={gitName ?? 'Tu nombre'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'ajuste-nombre-nota ajuste-nombre-error' : 'ajuste-nombre-nota'}
            onChange={(e) => {
              const r = profileNameInput(e.target.value);
              setTexto(r.text);
              // Un nombre demasiado largo no se guarda: se queda lo anterior hasta corregirlo.
              if (!r.error && r.value !== guardado) update({ profile: { name: r.value } });
            }}
          />
          {error && (
            <span id="ajuste-nombre-error" className="field__error" role="alert">
              {error}
            </span>
          )}
          <span id="ajuste-nombre-nota" className="field__note">
            Para el saludo de Inicio. Vacío, usa el nombre de Git{gitName ? ` (${gitName})` : ''}.
          </span>
        </div>
        <SelectField
          label="Pantalla al abrir"
          value={settings.startScreen}
          options={START_OPTIONS}
          onChange={(v) => update({ startScreen: v })}
        />
      </div>
    </fieldset>
  );
}

const TOGGLES = [
  { key: 'cursor', label: 'Cursor parpadeante en el logo', hint: 'El ▌ de ~/jdev-ai. Se para si el sistema pide menos movimiento.' },
  { key: 'lights', label: 'Luces piloto animadas', hint: 'El punto ámbar late y el anillo de «trabajando» gira.' },
  { key: 'ascii', label: 'Arte ASCII en los estados vacíos', hint: 'Por ejemplo ( -_-) zZ cuando no hay nada en curso.' },
  { key: 'greeting', label: 'Saludo según la hora', hint: '«Buenos días» en Inicio y en los estados vacíos. Desactivado, Inicio se titula «Inicio».' },
  { key: 'grid', label: 'Retícula de puntos de fondo', hint: 'Textura sutil en Inicio y en los estados vacíos, como papel de libreta.' },
] as const;

export function Appearance() {
  const { settings, update } = useSettings();
  const accentColor = ACCENT_CARDS.find((a) => a.id === settings.theme.accent)?.color ?? '#f0b25a';

  return (
    <section id="apariencia" className="set-section set-section--first" aria-labelledby="h-apariencia">
      <div className="set-section__intro">
        <h1 id="h-apariencia" className="set-h1">
          Apariencia
        </h1>
        <p className="set-lead">Cómo se ve el panel. Las terminales usan el mismo tema.</p>
      </div>

      <fieldset className="fieldset">
        <legend className="set-legend">Tema</legend>
        <div className="theme-grid">
          {THEME_CARDS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theme-card"
              aria-pressed={settings.theme.name === t.id}
              style={{ '--card-accent': accentColor } as React.CSSProperties}
              onClick={() => update({ theme: { name: t.id } })}
            >
              <span className="theme-card__preview" style={{ background: t.bg }} aria-hidden="true">
                <span className="theme-card__bar" style={{ background: t.panel }} />
                <span className="theme-card__row">
                  <span className="theme-card__side" style={{ background: t.panel }} />
                  <span className="theme-card__term" style={{ background: t.term }}>
                    <span className="theme-card__line" style={{ background: t.text, opacity: 0.7, width: '70%' }} />
                    <span className="theme-card__line" style={{ background: accentColor, width: '45%' }} />
                    <span className="theme-card__line" style={{ background: t.text, opacity: 0.4, width: '60%' }} />
                  </span>
                </span>
              </span>
              <span className="theme-card__text">
                <span className="theme-card__name">{t.name}</span>
                <span className="theme-card__hint">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <CheckRow
          label="Seguir el tema del sistema (Papel de día, el elegido de noche)"
          checked={settings.theme.followSystem}
          onChange={(v) => update({ theme: { followSystem: v } })}
        />
      </fieldset>

      <fieldset className="fieldset">
        <legend className="set-legend">Color de acento</legend>
        <div className="accent-row">
          {ACCENT_CARDS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="accent-btn"
              aria-pressed={settings.theme.accent === a.id}
              style={{ '--swatch': a.color } as React.CSSProperties}
              onClick={() => update({ theme: { accent: a.id } })}
            >
              <span className="accent-btn__dot" />
              {a.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="set-legend">Detalles con personalidad</legend>
        {TOGGLES.map((t) => (
          <SwitchRow
            key={t.key}
            label={t.label}
            hint={t.hint}
            checked={settings.personality[t.key]}
            onChange={(v) => update({ personality: { [t.key]: v } })}
          />
        ))}
      </fieldset>

      <InicioFields />
    </section>
  );
}
