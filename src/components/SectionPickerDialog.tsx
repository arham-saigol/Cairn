import * as Dialog from "@radix-ui/react-dialog";
import { Inbox, MoveRight, X } from "lucide-react";
import type { Section } from "../types";

export function SectionPickerDialog({
  open,
  onOpenChange,
  sections,
  count,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: Section[];
  count: number;
  onMove: (sectionId: string | null) => void | Promise<void>;
}) {
  const options = [{ id: null, name: "Inbox" }, ...sections];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[100] bg-black/20 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[101] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-[var(--border)] bg-[var(--popover)] p-4 text-[var(--text)] shadow-[var(--shadow-dialog)] outline-none">
          <div className="flex items-start justify-between gap-3 px-1">
            <div>
              <Dialog.Title className="text-sm font-semibold">Move to section</Dialog.Title>
              <Dialog.Description className="mt-1 text-[11px] text-[var(--subtle)]">
                Move {count === 1 ? "the selected card" : `${count} selected cards`}.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-lg p-1.5 text-[var(--subtle)] outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Cancel move"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div
            className="mt-3 max-h-72 space-y-1 overflow-y-auto"
            role="listbox"
            aria-label="Sections"
          >
            {options.map((section) => (
              <button
                key={section.id ?? "inbox"}
                className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => {
                  void onMove(section.id);
                  onOpenChange(false);
                }}
              >
                {section.id ? (
                  <MoveRight className="size-4 text-[var(--subtle)]" />
                ) : (
                  <Inbox className="size-4 text-[var(--subtle)]" />
                )}
                <span className="truncate">{section.name}</span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
