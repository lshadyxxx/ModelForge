import { useEffect, useRef, type ReactNode } from 'react';

export function ComputeDialog({
  labelledBy,
  className = '',
  children,
  onClose,
  dismissible = true,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    const focusTarget = element.querySelector<HTMLElement>(
      '[data-dialog-autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    );
    focusTarget?.focus();
    return () => {
      if (element.open) element.close();
      returnFocus.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`mf-dialog ${className}`.trim()}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
