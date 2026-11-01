import { useId } from 'react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { integerError } from '../lib/validation.ts';

/** Interruptor accesible (role=switch) con título y ayuda, como en el diseño de Ajustes. */
export function SwitchRow(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const idHint = useId();
  return (
    <div className="switch-row">
      <span className="switch-row__text">
        <span className="switch-row__label">{props.label}</span>
        <span className="switch-row__hint" id={idHint}>
          {props.hint}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        aria-describedby={idHint}
        className="switch"
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="switch__knob" />
      </button>
    </div>
  );
}

export function CheckRow(props: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <span className="check__hint">{props.hint}</span>}
      </span>
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RangeField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="field field--range">
      <label htmlFor={id} className="range-label">
        {props.label}
        <span className="range-label__value">
          {String(props.value).replace('.', ',')} {props.unit ?? 'px'}
        </span>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

/**
 * Campo numérico entero con validación visible: mientras el texto no sea válido
 * muestra el error junto al campo (aria-invalid y aria-describedby) y no guarda
 * nada; el último valor guardado sigue siendo el efectivo.
 */
export function IntegerField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Texto de ayuda bajo el campo. */
  note: ReactNode;
  onCommit: (v: number) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const error = texto === null ? null : integerError(texto, props.min, props.max);
  const idNota = `${props.id}-nota`;
  const idError = `${props.id}-error`;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="number"
        className="input"
        min={props.min}
        max={props.max}
        step={props.step}
        value={texto ?? String(props.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? `${idError} ${idNota}` : idNota}
        onChange={(e) => {
          setTexto(e.target.value);
          if (integerError(e.target.value, props.min, props.max) === null) props.onCommit(Number(e.target.value));
        }}
        // Con un valor inválido se conserva lo escrito y su error: no se revierte en silencio.
        onBlur={() => {
          if (texto !== null && integerError(texto, props.min, props.max) === null) setTexto(null);
        }}
      />
      {error && (
        <span id={idError} className="field__error" role="alert">
          {error}
        </span>
      )}
      <span id={idNota} className="field__note">
        {props.note}
      </span>
    </div>
  );
}
