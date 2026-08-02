import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "./ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: "delete" | "clear";
  count?: number;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  variant,
  count = 0,
  onConfirm,
}: ConfirmDialogProps) {
  const clear = variant === "clear";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-[100] bg-black/20 backdrop-blur-[2px]" />
        <AlertDialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[101] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-[var(--border)] bg-[var(--popover)] p-5 text-[var(--text)] shadow-[var(--shadow-dialog)] outline-none">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]">
            {clear ? <AlertTriangle className="size-5" /> : <Trash2 className="size-5" />}
          </div>
          <AlertDialog.Title className="text-base font-semibold tracking-[-0.01em]">
            {clear
              ? "Clear all Cairn content?"
              : `Delete ${count === 1 ? "this card" : `${count} cards`}?`}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-5 text-[var(--muted-text)]">
            {clear
              ? "This removes every card and section from Cairn. Appearance and keybindings stay unchanged. A recoverable local backup will be created."
              : "The selected cards will be removed from this device."}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="destructive" onClick={() => void onConfirm()}>
                {clear ? "Clear Cairn" : "Delete"}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
