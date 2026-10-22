"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A native modal makes the conversation inert, handles Tab across PDF iframes,
// and returns focus without requiring a second keyboard-only dialog system.
export function FilePreviewDialog({ labelledBy, onDismiss, children }: {
  labelledBy: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return <dialog
    ref={dialogRef}
    className="file-preview-backdrop"
    aria-labelledby={labelledBy}
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
  >{children}</dialog>;
}
