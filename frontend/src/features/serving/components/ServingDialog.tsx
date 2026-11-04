import {useEffect, useRef, type ReactNode} from 'react';

export function ServingDialog({
  titleId,
  className = '',
  onClose,
  children,
}: {
  titleId: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    const frame = window.requestAnimationFrame(() => {
      const explicit = element.querySelector<HTMLElement>('[data-dialog-autofocus]');
      const firstField = element.querySelector<HTMLElement>(
        '.serving-dialog-form .mf-select__trigger:not([disabled]), '
        + '.serving-dialog-form input:not([disabled]):not([type="hidden"]), '
        + '.serving-dialog-form select:not([disabled]), '
        + '.serving-dialog-form textarea:not([disabled])',
      );
      (explicit ?? firstField)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (element.open) element.close();
      const target = returnFocus.current;
      if (target?.isConnected) window.requestAnimationFrame(() => {
        if (target.isConnected) target.focus();
      });
    };
  }, []);

  return <dialog
    ref={dialog}
    className={'serving-dialog ' + className}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
    onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}
  >{children}</dialog>;
}
