import { useEffect, useRef, useState } from 'react';
import { api, imageUrl } from '../../api.ts';
import { resolveLocalPath, shortDateMs } from '../../lib/backlog.ts';
import type { Guide, GuideContent, ProjectInfo } from '../../types.ts';
import { Markdown } from '../Markdown.tsx';

export function GuidesTab({ project }: { project: ProjectInfo }) {
  const [guias, setGuias] = useState<Guide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [contenido, setContenido] = useState<GuideContent | null>(null);
  const [errorGuia, setErrorGuia] = useState<string | null>(null);
  const lector = useRef<HTMLElement>(null);

  useEffect(() => {
    const control = new AbortController();
    setGuias(null);
    setError(null);
    setElegida(null);
    api
      .guides(project.id, control.signal)
      .then((g) => setGuias(g))
      .catch((e: unknown) => {
        if (!control.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => control.abort();
  }, [project.id]);

  useEffect(() => {
    if (elegida === null) {
      setContenido(null);
      return;
    }
    const control = new AbortController();
    setContenido(null);
    setErrorGuia(null);
    api
      .guide(project.id, elegida, control.signal)
      .then((c) => {
        setContenido(c);
        lector.current?.focus({ preventScroll: true });
      })
      .catch((e: unknown) => {
        if (!control.signal.aborted) setErrorGuia(e instanceof Error ? e.message : String(e));
      });
    return () => control.abort();
  }, [project.id, elegida]);

  if (error) return <p className="ptab__error" role="alert">{error}</p>;
  if (!guias) return <p className="ptab__empty">Cargando…</p>;
  if (guias.length === 0) return <p className="ptab__empty">Este proyecto no tiene guías en docs/user-guides/.</p>;

  const dir = elegida ? `${project.path}/docs/user-guides/${elegida.replace(/\/?[^/]*$/, '')}` : '';
  const imageHref = (src: string) => {
    const abs = project.path ? resolveLocalPath(dir, src) : null;
    return abs ? imageUrl(abs) : null;
  };

  return (
    <div className="guides">
      <nav className="guides__list" aria-label="Guías">
        <ul>
          {guias.map((g) => (
            <li key={g.path}>
              <button type="button" className="guides__item" aria-current={g.path === elegida ? 'true' : undefined} onClick={() => setElegida(g.path)}>
                <span className="guides__title">{g.title}</span>
                <span className="guides__meta">
                  <span className="guides__path">{g.path}</span>
                  <span className="guides__date">{shortDateMs(g.updated)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="guides__reader" ref={lector} tabIndex={-1} aria-label={contenido ? contenido.title : 'Lector de guías'}>
        {errorGuia ? (
          <p className="ptab__error" role="alert">
            {errorGuia}
          </p>
        ) : elegida === null ? (
          <p className="ptab__empty">Elige una guía para leerla.</p>
        ) : !contenido ? (
          <p className="ptab__empty">Cargando…</p>
        ) : (
          <Markdown source={contenido.source} className="md--guide" imageHref={imageHref} />
        )}
      </article>
    </div>
  );
}
