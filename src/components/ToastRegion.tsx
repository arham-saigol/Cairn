import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

export interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  kind?: "success" | "info";
}

function ToastAction({
  toast,
  dismiss,
  onError,
}: {
  toast: ToastState;
  dismiss: () => void;
  onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-my-1 h-7 px-2 text-[var(--accent)]"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        let failure: unknown;
        try {
          await toast.onAction?.();
        } catch (error) {
          failure = error;
        } finally {
          dismiss();
          if (failure !== undefined) onError(failure);
        }
      }}
    >
      {toast.actionLabel}
    </Button>
  );
}

export function ToastRegion({
  toast,
  dismiss,
  onActionError,
}: {
  toast: ToastState | null;
  dismiss: () => void;
  onActionError?: (error: unknown) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[92px] z-[90] flex justify-center px-5"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {toast ? (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--toast)] px-3 py-2 text-xs font-medium text-[var(--text)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
          >
            {toast.kind === "info" ? (
              <Info className="size-3.5 text-[var(--accent)]" />
            ) : (
              <CheckCircle2 className="size-3.5 text-[var(--accent)]" />
            )}
            <span>{toast.message}</span>
            {toast.actionLabel ? (
              <ToastAction
                key={toast.id}
                toast={toast}
                dismiss={dismiss}
                onError={onActionError ?? (() => undefined)}
              />
            ) : null}
            <button
              className="-mr-1 rounded-md p-1 text-[var(--subtle)] hover:text-[var(--text)]"
              aria-label="Dismiss notification"
              onClick={dismiss}
            >
              <X className="size-3" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
