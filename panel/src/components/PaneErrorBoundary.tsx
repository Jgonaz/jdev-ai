import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = { label: string; children: ReactNode };
type State = { error: Error | null };

/**
 * Contiene el fallo de una pestaña (terminal o seguimiento): sin esto, un error
 * al pintar desmonta el panel entero y la ventana se queda en negro. Muestra el
 * error en su hueco y permite volver a intentarlo; el resto del panel sigue.
 */
export class PaneErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Fallo en la pestaña «${this.props.label}»:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <section className="pane pane--error" role="alert">
        <div className="pane__crash">
          <strong>Esta pestaña ha fallado</strong>
          <span className="mono-text">{this.state.error.message}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }
}
