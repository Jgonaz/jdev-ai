import { useState } from 'react';
import { DEFAULT_PORT } from '../../../shared/settings-schema.ts';
import { IntegerField } from '../../components/controls.tsx';
import { IconLock } from '../../components/Icons.tsx';
import { useSettings } from '../../state/SettingsContext.tsx';

const COMANDO_TOKEN = 'bin/panel --regenerate-token';

export function ServerSection() {
  const { settings, update } = useSettings();
  const [copiado, setCopiado] = useState(false);
  const enUso = window.location.port || String(DEFAULT_PORT);
  const pendienteReinicio = String(settings.port) !== enUso;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(COMANDO_TOKEN);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // El comando sigue visible para copiarlo a mano.
    }
  };

  return (
    <section id="servidor" className="set-section" aria-labelledby="h-serv">
      <h2 id="h-serv" className="set-h2">
        Servidor local
      </h2>
      <div className="grid2">
        <IntegerField
          id="puerto"
          label="Puerto"
          value={settings.port}
          min={1024}
          max={65535}
          note={`Entre 1024 y 65535. Requiere reiniciar bin/panel para aplicarse${pendienteReinicio ? ` (ahora escucha en el ${enUso}).` : '.'}`}
          onCommit={(v) => update({ port: v })}
        />
        <div className="field">
          <span className="field__label">Escucha en</span>
          <span className="fixed-field">
            <IconLock size={14} />
            127.0.0.1 · fijo
          </span>
        </div>
      </div>
      <div className="token-row">
        <span className="token-row__label">Token de acceso</span>
        <code className="token-row__value" aria-label="Token oculto">
          ••••••••••••••••
        </code>
      </div>
      <p className="hint">
        El panel no regenera el token desde aquí. Para invalidarlo y crear uno nuevo, ejecuta en una terminal y vuelve a abrir la URL que imprime:
      </p>
      <div className="token-cmd">
        <code>{COMANDO_TOKEN}</code>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copiar()}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </section>
  );
}
