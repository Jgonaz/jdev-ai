import { useEffect } from 'react';
import { focusActiveTabSoon } from '../../lib/focus.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { TerminateDialog } from './TerminateDialog.tsx';

/**
 * Diálogo de cierre de la pestaña de una sesión hecha y viva (Cancelar / Dejar en
 * segundo plano / Terminar sesión). Una sola instancia, junto a la raíz de la app,
 * para que la «×», el clic central, «Cerrar pestaña» y Ctrl+W compartan el flujo.
 */
export function CloseDoneDialog() {
  const { sessions } = useSessions();
  const { closeRequest, clearCloseRequest, closeTab, requestTerminalFocus } = useWorkspace();
  const session = closeRequest ? sessions.find((s) => s.name === closeRequest.name) : undefined;

  // La sesión terminó por otro lado mientras se preguntaba: ya no hay nada que confirmar.
  useEffect(() => {
    if (closeRequest && !session) clearCloseRequest();
  }, [closeRequest, session, clearCloseRequest]);

  if (!closeRequest || !session) return null;
  return (
    <TerminateDialog
      session={session}
      onClose={clearCloseRequest}
      onKeepInBackground={() => {
        clearCloseRequest();
        closeTab(session.name);
        // Cancelar devuelve el foco a donde estaba; aquí ese sitio se ha cerrado.
        if (closeRequest.fromTerminal) requestTerminalFocus();
        else focusActiveTabSoon();
      }}
    />
  );
}
