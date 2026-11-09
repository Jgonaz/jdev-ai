import { useEffect, useState } from 'react';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import { IconKeyboard } from './Icons.tsx';
import { Modal } from './Modal.tsx';
import { ShortcutsList } from './ShortcutsList.tsx';

/** Botón de la cabecera que abre la chuleta con todos los atajos de teclado. */
export function HeaderShortcuts() {
  const [abierto, setAbierto] = useState(false);
  const { dialogOpen } = useWorkspace();

  // Los atajos globales siguen activos con la chuleta abierta: si uno abre otro
  // diálogo (Ctrl+Alt+N), la chuleta se cierra para no apilar dos trampas de foco.
  useEffect(() => {
    if (dialogOpen) setAbierto(false);
  }, [dialogOpen]);

  return (
    <>
      <button
        type="button"
        className="icon-btn hdrghost"
        aria-label="Atajos de teclado"
        title="Atajos de teclado"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => setAbierto(true)}
      >
        <IconKeyboard size={18} />
      </button>
      {abierto && (
        <Modal title="Atajos de teclado" onClose={() => setAbierto(false)} width={620}>
          <ShortcutsList headingLevel={2} />
        </Modal>
      )}
    </>
  );
}
