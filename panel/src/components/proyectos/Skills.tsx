import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { skillSections, skillTags } from '../../lib/skills.ts';
import type { SkillContent, SkillSummary } from '../../types.ts';
import { IconChevron } from '../Icons.tsx';
import { Markdown } from '../Markdown.tsx';

/**
 * Skills de un proyecto (o las de usuario) y su lector (pantalla Skills). La lista
 * y la skill abierta vienen de la pantalla, que la lleva en la ruta
 * (`#/skills/<id>/<nombre>`); aquí solo se carga el contenido de la skill elegida.
 */
export function SkillsView(props: {
  /** Identificador del proyecto, o `USER_PROJECT` para las skills de usuario. */
  projectId: string;
  skills: SkillSummary[] | null;
  error: string | null;
  /** Texto del estado vacío. */
  empty: string;
  /** Nombre de la skill abierta, ya comprobado contra la lista. */
  elegida: string | null;
  onSelect: (name: string) => void;
}) {
  const { skills, error, elegida } = props;
  const lista = useRef<HTMLElement>(null);
  const cargada = skills !== null && skills.length > 0;
  // «De terceros» empieza plegada; la vista se vuelve a montar con cada proyecto, así que se pliega de nuevo al cambiar.
  const [tercerosAbierta, setTercerosAbierta] = useState(false);
  const elegidaDeTerceros = skills?.some((s) => s.name === elegida && !s.own) ?? false;
  // Sin propias, plegarla dejaría la lista vacía.
  const soloTerceros = cargada && skills.every((s) => !s.own);
  // Si la skill abierta (por la URL o al volver atrás) es de terceros, o no hay propias, la sección se despliega.
  useEffect(() => {
    if (elegidaDeTerceros || soloTerceros) setTercerosAbierta(true);
  }, [elegidaDeTerceros, soloTerceros, elegida]);
  // Con un enlace directo o al recargar, la skill abierta puede quedar lejos en la
  // lista (que tiene scroll propio): se lleva a la vista una vez, en cuanto está pintada, no en cada clic.
  const porLlevar = useRef(true);
  useEffect(() => {
    if (!cargada || !porLlevar.current) return;
    const item = lista.current?.querySelector('[aria-current="true"]');
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
      porLlevar.current = false;
    } else if (!elegidaDeTerceros) porLlevar.current = false;
  }, [cargada, tercerosAbierta, elegidaDeTerceros]);
  if (error) return <p className="ptab__error" role="alert">{error}</p>;
  if (!skills) return <p className="ptab__empty">Cargando…</p>;
  if (skills.length === 0) return <p className="ptab__empty">{props.empty}</p>;
  const skill = skills.find((s) => s.name === elegida) ?? null;

  return (
    <div className="guides skills">
      <nav className="guides__list skills__list" ref={lista} aria-label="Skills">
        {skillSections(skills).map((seccion) => (
          <section key={seccion.key} className="skills__section" aria-labelledby={`skills-${seccion.key}`}>
            {seccion.key === 'third' ? (
              <h3 className="skills__sectionh" id={`skills-${seccion.key}`}>
                <button type="button" className="skills__toggle" aria-expanded={tercerosAbierta} aria-controls={tercerosAbierta ? 'skills-third-list' : undefined} onClick={() => setTercerosAbierta((a) => !a)}>
                  <IconChevron size={12} className={`collapsible__chevron${tercerosAbierta ? ' collapsible__chevron--open' : ''}`} />
                  {seccion.title} <span className="skills__sectionn">{seccion.skills.length}</span>
                </button>
              </h3>
            ) : (
              <h3 className="skills__sectionh" id={`skills-${seccion.key}`}>
                {seccion.title} <span className="skills__sectionn">{seccion.skills.length}</span>
              </h3>
            )}
            {(seccion.key !== 'third' || tercerosAbierta) && (
              <ul id={seccion.key === 'third' ? 'skills-third-list' : undefined}>
                {seccion.skills.map((s) => (
                  <li key={s.name}>
                    <button type="button" className="guides__item skills__item" aria-current={s.name === elegida ? 'true' : undefined} onClick={() => props.onSelect(s.name)}>
                      <span className="guides__title">{s.name}</span>
                      {s.description && <span className="skills__desc">{s.description}</span>}
                      <span className="skills__tags">
                        {skillTags(s).map((t) => (
                          <span key={t.label} className={`skills__tag skills__tag--${t.agent}`}>
                            {t.label}
                          </span>
                        ))}
                      </span>
                      {s.diverges && <span className="skills__warn">Las copias difieren</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </nav>
      {skill ? (
        <SkillReader key={`${props.projectId}/${skill.name}`} projectId={props.projectId} skill={skill} />
      ) : (
        <article className="guides__reader skills__reader" aria-label="Lector de skills">
          <p className="ptab__empty">Elige una skill para leerla.</p>
        </article>
      )}
    </div>
  );
}

// Valor de un campo del frontmatter: el texto tal cual y el resto (listas, objetos…) como JSON.
const campo = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

// Campos del frontmatter con name y description primero y el resto en su orden.
function campos(fm: Record<string, unknown>): [string, unknown][] {
  const primeros = ['name', 'description'].filter((k) => Object.hasOwn(fm, k));
  return [...primeros, ...Object.keys(fm).filter((k) => !primeros.includes(k))].map((k) => [k, fm[k]]);
}

// El lector de una skill: se vuelve a montar al cambiar de skill (`key`), así que la copia elegida empieza en la de por defecto.
function SkillReader({ projectId, skill }: { projectId: string; skill: SkillSummary }) {
  const [copia, setCopia] = useState(0);
  const [contenido, setContenido] = useState<SkillContent | null>(null);
  const [errorLector, setErrorLector] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [errorAbrir, setErrorAbrir] = useState<string | null>(null);
  const lector = useRef<HTMLElement>(null);
  const idCopia = useId();

  useEffect(() => {
    const control = new AbortController();
    setContenido(null);
    setErrorLector(null);
    setErrorAbrir(null);
    api
      .skill(projectId, skill.name, copia, control.signal)
      .then((c) => {
        setContenido(c);
        lector.current?.focus({ preventScroll: true });
      })
      .catch((e: unknown) => {
        if (!control.signal.aborted) setErrorLector(e instanceof Error ? e.message : String(e));
      });
    return () => control.abort();
  }, [projectId, skill.name, copia]);

  const abrir = () => {
    setAbriendo(true);
    setErrorAbrir(null);
    api
      .openSkill(projectId, skill.name, copia)
      .catch((e: unknown) => setErrorAbrir(e instanceof Error ? e.message : String(e)))
      .finally(() => setAbriendo(false));
  };

  const actual = skill.copies[copia];
  return (
    <article className="guides__reader skills__reader" ref={lector} tabIndex={-1} aria-label={`Skill ${skill.name}`}>
      <header className="skills__head">
        <div className="skills__headrow">
          <h2 className="skills__name">{skill.name}</h2>
          <span className={`skills__origin skills__origin--${skill.own ? 'own' : 'third'}`}>{skill.own ? 'Propia' : 'De terceros'}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={abrir} disabled={abriendo}>
            Abrir en VS Code
          </button>
        </div>
        {errorAbrir && (
          <p className="ptab__error" role="alert">
            {errorAbrir}
          </p>
        )}
        <div className="skills__source">
          {skill.copies.length > 1 ? (
            <>
              <label htmlFor={idCopia}>Copia que se lee</label>
              <select id={idCopia} className="input skills__select" value={copia} onChange={(e) => setCopia(Number(e.target.value))}>
                {skill.copies.map((c, i) => (
                  <option key={c.path} value={i}>
                    {c.label} · {c.path}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span>
              Se lee de <code>{actual?.path}</code>
            </span>
          )}
          {skill.diverges && <span className="skills__warn">Las copias difieren</span>}
        </div>
      </header>
      {errorLector ? (
        <p className="ptab__error" role="alert">
          {errorLector}
        </p>
      ) : !contenido ? (
        <p className="ptab__empty">Cargando…</p>
      ) : (
        <>
          {Object.keys(contenido.frontmatter).length > 0 && (
            <dl className="skills__fm" aria-label="Frontmatter">
              {campos(contenido.frontmatter).map(([k, v]) => (
                <div key={k} className="skills__fmrow">
                  <dt>{k}</dt>
                  <dd>{campo(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <Markdown source={contenido.body} className="md--guide" />
          <section className="skills__files" aria-label="Archivos de la carpeta">
            <h3 className="skills__filesh">Archivos de la carpeta</h3>
            {contenido.files.length === 0 ? (
              <p className="ptab__note">Solo tiene SKILL.md.</p>
            ) : (
              <ul>
                {contenido.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </article>
  );
}
