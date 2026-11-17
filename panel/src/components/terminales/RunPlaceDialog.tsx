import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { suggestRunPlace } from '../../lib/runPlace.ts';
import type { ProjectInfo } from '../../types.ts';
import { Modal } from '../Modal.tsx';
import { useRadioGroup } from '../useRadioGroup.ts';

/**
 * Elección de dónde arranca ▶ un proyecto con worktrees abiertos: el checkout
 * principal o uno de sus worktrees. Propone el último lugar usado. Intro o doble
 * clic en una opción arranca directamente.
 */
export function RunPlaceDialog({ project, command, onClose, onStart }: {
  project: ProjectInfo;
  /** Comando de arranque del checkout principal (un worktree puede detectar otro). */
  command: string;
  onClose: () => void;
  onStart: (worktree: string) => void;
}) {
  const idForm = useId();
  const idLeyenda = useId();
  const [elegido, setElegido] = useState(() => suggestRunPlace(project));
  const opciones = [{ value: '' }, ...project.worktrees.map((w) => ({ value: w.name }))];
  const grupo = useRadioGroup(opciones, elegido, setElegido);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onStart(elegido);
  };

  return (
    <Modal
      title={`Arrancar ${project.name}`}
      onClose={onClose}
      width={480}
      initialFocus='[role="radio"][aria-checked="true"]'
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--lg footer-push" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form={idForm} className="btn btn--accent btn--lg">
            Arrancar
          </button>
        </>
      }
    >
      <form id={idForm} onSubmit={enviar}>
        <fieldset className="fieldset fieldset--gap8" aria-labelledby={idLeyenda} {...grupo.groupProps}>
          <legend id={idLeyenda} className="field__label">
            Dónde se ejecuta <code>{command}</code>
          </legend>
          <PlaceRadio
            radio={grupo.radioProps({ value: '' })}
            label="Checkout principal"
            hint={project.branch ? `Rama ${project.branch}` : 'Carpeta del proyecto'}
            onPick={() => onStart('')}
          />
          {project.worktrees.map((w) => (
            <PlaceRadio
              key={w.name}
              radio={grupo.radioProps({ value: w.name })}
              label={w.branch ?? `feat/${w.name}`}
              hint={`Worktree ${w.name}`}
              onPick={() => onStart(w.name)}
            />
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

function PlaceRadio(props: { radio: ReturnType<ReturnType<typeof useRadioGroup<string>>['radioProps']>; label: string; hint: string; onPick: () => void }) {
  return (
    <button
      type="button"
      className="place"
      {...props.radio}
      onDoubleClick={props.onPick}
      // Intro en un botón lo pulsaría (solo elegir): aquí arranca, como el botón del pie.
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        props.onPick();
      }}
    >
      <span className="place__radio" aria-hidden="true" />
      <span className="place__text">
        <span className="place__label">{props.label}</span>
        <span className="place__hint">{props.hint}</span>
      </span>
    </button>
  );
}
