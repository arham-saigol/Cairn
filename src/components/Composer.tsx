import { CornerDownLeft, Hash, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "../lib/utils";

export const SECTION_INPUT_PATTERN = /^#\s+\S/;

interface ComposerProps {
  value: string;
  setValue: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void | Promise<void>;
  sectionName?: string;
}

export function Composer({ value, setValue, inputRef, onSubmit, sectionName }: ComposerProps) {
  const creatingSection = SECTION_INPUT_PATTERN.test(value.trimStart());

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(116, textarea.scrollHeight)}px`;
  }, [inputRef, value]);

  return (
    <div className="relative z-40 shrink-0 px-3 pb-3 pt-2">
      <motion.div
        layout
        className="composer flex min-h-[66px] items-start gap-2 rounded-[22px] border border-[var(--border)] bg-[var(--composer)] px-3 py-3 shadow-[var(--shadow-composer)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)]"
      >
        <div
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--check-border)] text-[var(--subtle)] transition-colors",
            creatingSection &&
              "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]",
          )}
        >
          {creatingSection ? <Hash className="size-3.5" /> : <Plus className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void onSubmit();
              }
            }}
            placeholder={sectionName ? `Add to ${sectionName}…` : "Add a note, prompt, or task…"}
            aria-label="New card"
            className="block max-h-[116px] min-h-6 w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 text-[var(--text)] outline-none placeholder:text-[var(--subtle)]"
          />
          {value ? (
            <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--subtle)]">
              <span>{creatingSection ? "Create a section" : "Shift+Enter for a new line"}</span>
              <span className="inline-flex items-center gap-1">
                Add <CornerDownLeft className="size-3" />
              </span>
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
