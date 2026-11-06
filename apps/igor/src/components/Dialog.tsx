// Native modal <dialog>; the browser provides focus trapping and Escape.

import { useEffect, useId, useRef, type ReactNode } from 'react';

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="igor-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 className="igor-dialog__title" id={titleId}>
        {title}
      </h2>
      {children}
      <button type="button" className="igor-action" onClick={() => ref.current?.close()}>
        <span>Close</span>
      </button>
    </dialog>
  );
}
