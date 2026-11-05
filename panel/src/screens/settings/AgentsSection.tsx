import { SelectField } from '../../components/controls.tsx';
import { AGENT_CHOICES } from '../../lib/sessions.ts';
import { AGENTS } from '../../../shared/settings-schema.ts';
import { useSettings } from '../../state/SettingsContext.tsx';
import type { Settings } from '../../types.ts';

const AGENTES = AGENTS.map((value) => ({ value, label: AGENT_CHOICES[value] }));
const LUGARES = [
  { value: 'principal', label: 'Checkout principal' },
  { value: 'worktree-nuevo', label: 'Worktree nuevo' },
] as const;

export function AgentsSection() {
  const { settings, update } = useSettings();
  return (
    <section id="agentes" className="set-section" aria-labelledby="h-agentes">
      <h2 id="h-agentes" className="set-h2">
        Agentes
      </h2>
      <div className="grid2">
        <SelectField<Settings['newSession']['agent']>
          label="Agente por defecto"
          value={settings.newSession.agent}
          options={AGENTES}
          onChange={(v) => update({ newSession: { agent: v } })}
        />
        <SelectField<Settings['newSession']['location']>
          label="Dónde trabaja por defecto"
          value={settings.newSession.location}
          options={LUGARES}
          onChange={(v) => update({ newSession: { location: v } })}
        />
      </div>
    </section>
  );
}
