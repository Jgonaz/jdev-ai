import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { commandLine, mcpSections, mcpSummaryLine, transportLabel } from '../../lib/mcps.ts';
import { skillTags } from '../../lib/skills.ts';
import type { McpCopy, McpSummary } from '../../types.ts';

/**
 * MCPs de un proyecto (o los de usuario) y su detalle (pantalla MCPs). La lista y el
 * MCP abierto vienen de la pantalla, que lo lleva en la ruta (`#/mcps/<id>/<nombre>`).
 * La lista ya trae la configuración normalizada y sin secretos, así que el detalle no
 * pide nada: solo la acción de abrir el archivo en VS Code.
 */
export function McpsView(props: {
  /** Identificador del proyecto, o `USER_PROJECT` para los MCPs de usuario. */
  projectId: string;
  mcps: McpSummary[] | null;
  error: string | null;
  /** Texto del estado vacío. */
  empty: string;
  /** Nombre del MCP abierto, ya comprobado contra la lista. */
  elegido: string | null;
  onSelect: (name: string) => void;
}) {
  const { mcps, error, elegido } = props;
  const lista = useRef<HTMLElement>(null);
  const cargada = mcps !== null && mcps.length > 0;
  // Con un enlace directo o al recargar, el MCP abierto puede quedar lejos en la lista
  // (que tiene scroll propio): se lleva a la vista una vez, en cuanto está pintada, no en cada clic.
  const porLlevar = useRef(true);
  useEffect(() => {
    if (!cargada || !porLlevar.current) return;
    lista.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    porLlevar.current = false;
  }, [cargada]);
  if (error) return <p className="ptab__error" role="alert">{error}</p>;
  if (!mcps) return <p className="ptab__empty">Cargando…</p>;
  if (mcps.length === 0) return <p className="ptab__empty">{props.empty}</p>;
  const mcp = mcps.find((m) => m.name === elegido) ?? null;

  return (
    <div className="guides skills">
      <nav className="guides__list skills__list" ref={lista} aria-label="MCPs">
        {mcpSections(mcps).map((seccion) => (
          <section key={seccion.key} className="skills__section" aria-labelledby={`mcps-${seccion.key}`}>
            <h3 className="skills__sectionh" id={`mcps-${seccion.key}`}>
              {seccion.title} <span className="skills__sectionn">{seccion.mcps.length}</span>
            </h3>
            <ul>
              {seccion.mcps.map((m) => (
                <li key={m.name}>
                  <button type="button" className="guides__item skills__item" aria-current={m.name === elegido ? 'true' : undefined} onClick={() => props.onSelect(m.name)}>
                    <span className="guides__title">{m.name}</span>
                    {mcpSummaryLine(m) && <span className="skills__desc mcps__line">{mcpSummaryLine(m)}</span>}
                    <span className="skills__tags">
                      {skillTags(m).map((t) => (
                        <span key={t.label} className={`skills__tag skills__tag--${t.agent}`}>
                          {t.label}
                        </span>
                      ))}
                    </span>
                    {m.diverges && <span className="skills__warn">La configuración difiere</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      {mcp ? (
        <McpReader key={`${props.projectId}/${mcp.name}`} projectId={props.projectId} mcp={mcp} />
      ) : (
        <article className="guides__reader skills__reader" aria-label="Detalle de MCPs">
          <p className="ptab__empty">Elige un MCP para ver su configuración.</p>
        </article>
      )}
    </div>
  );
}

// El detalle de un MCP: una sección por copia. Se vuelve a montar al cambiar de MCP (`key`).
function McpReader({ projectId, mcp }: { projectId: string; mcp: McpSummary }) {
  const hayNombres = mcp.copies.some((c) => c.envNames.length > 0 || c.headerNames.length > 0);
  return (
    <article className="guides__reader skills__reader" tabIndex={-1} aria-label={`MCP ${mcp.name}`}>
      <header className="skills__head">
        <div className="skills__headrow">
          <h2 className="skills__name">{mcp.name}</h2>
          <span className="skills__origin">{transportLabel(mcp.copies[0]?.transport ?? 'stdio')}</span>
        </div>
        {mcp.diverges && <p className="skills__warn">La configuración difiere entre las copias.</p>}
      </header>
      {mcp.copies.map((c, i) => (
        <McpCopySection key={`${c.label}/${c.path ?? ''}/${i}`} projectId={projectId} name={mcp.name} index={i} copy={c} />
      ))}
      {hayNombres && <p className="ptab__note">De las variables de entorno y las cabeceras solo se muestran los nombres: sus valores no salen del servidor del panel.</p>}
    </article>
  );
}

function McpCopySection({ projectId, name, index, copy }: { projectId: string; name: string; index: number; copy: McpCopy }) {
  const [abriendo, setAbriendo] = useState(false);
  const [errorAbrir, setErrorAbrir] = useState<string | null>(null);
  const abrir = () => {
    setAbriendo(true);
    setErrorAbrir(null);
    api
      .openMcp(projectId, name, index)
      .catch((e: unknown) => setErrorAbrir(e instanceof Error ? e.message : String(e)))
      .finally(() => setAbriendo(false));
  };
  const comando = commandLine(copy);
  const extra = Object.entries(copy.extra);
  return (
    <section className="mcps__copy" aria-label={`Copia de ${copy.label}`}>
      <div className="skills__headrow">
        <span className={`skills__tag skills__tag--${copy.agent}`}>{copy.label}</span>
        {copy.path && <code className="mcps__path">{copy.path}</code>}
        {copy.openable && (
          <button type="button" className="btn btn--ghost btn--sm mcps__open" onClick={abrir} disabled={abriendo} aria-label={`Abrir en VS Code la copia de ${copy.label}`}>
            Abrir en VS Code
          </button>
        )}
      </div>
      {errorAbrir && (
        <p className="ptab__error" role="alert">
          {errorAbrir}
        </p>
      )}
      {copy.transport === 'connector' ? (
        <p className="ptab__note">Conector de claude.ai: su configuración no está en este equipo, solo se sabe que se ha conectado alguna vez (puede haberse desconectado después).</p>
      ) : (
        <>
          {copy.incomplete && <p className="skills__warn">Este MCP no se pudo leer entero: puede faltar algún dato.</p>}
          <dl className="skills__fm">
            <Fila nombre="Transporte">{transportLabel(copy.transport)}</Fila>
            {comando !== null && (
              <Fila nombre="Comando">
                <code>{comando}</code>
              </Fila>
            )}
            {copy.url !== null && (
              <Fila nombre="URL">
                <code>{copy.url}</code>
              </Fila>
            )}
            {copy.envNames.length > 0 && <Fila nombre="Variables de entorno"><Nombres nombres={copy.envNames} /></Fila>}
            {copy.headerNames.length > 0 && <Fila nombre="Cabeceras"><Nombres nombres={copy.headerNames} /></Fila>}
            {extra.map(([k, v]) => (
              <Fila key={k} nombre={k}>
                {String(v)}
              </Fila>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="skills__fmrow">
      <dt>{nombre}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Nombres({ nombres }: { nombres: string[] }) {
  return (
    <span className="mcps__names">
      {nombres.map((n) => (
        <code key={n}>{n}</code>
      ))}
    </span>
  );
}
