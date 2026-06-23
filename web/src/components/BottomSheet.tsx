"use client";

import { useEffect, useRef } from "react";

/**
 * Shared bottom-sheet chrome for the Explore map sheets. Provides:
 *  - dialog semantics (role="dialog" + aria-modal) so screen readers announce it,
 *  - focus moved into the sheet on open and restored to the trigger on close,
 *  - Escape-to-close,
 *  - the drag-handle + ✕ close button that every sheet shares.
 *
 * It's deliberately NOT a hard focus trap: the date pickers / filters above the
 * map stay reachable, since changing dates updates the sheet's own content.
 */
export default function BottomSheet({
  onClose,
  children,
  labelledBy,
  className = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={`fixed inset-x-0 bottom-16 z-30 max-h-[72vh] overflow-y-auto rounded-t-2xl bg-white px-5 pb-5 pt-0 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] outline-none md:bottom-0 ${className}`}
    >
      <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between bg-white/95 px-5 pb-2 pt-3 backdrop-blur">
        <div className="mx-auto h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />
        <button
          onClick={onClose}
          className="absolute right-4 top-2 rounded-full bg-stone-100 px-2 py-0.5 text-stone-500 hover:bg-stone-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}
