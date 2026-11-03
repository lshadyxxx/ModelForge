import {useEffect, useRef, type ReactNode} from 'react';

export function TrainingDialog({
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
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      const target = returnFocus.current;
      if (target?.isConnected) {
        requestAnimationFrame(() => {
          if (target.isConnected) target.focus();
        });
      }
    };
  }, []);
  return <dialog
    ref={dialog}
    className={'training-dialog ' + className}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}
  >{children}</dialog>;
}
