import { shortcutTokens } from "../../lib/keybindings";
import { cn } from "../../lib/utils";

export function Shortcut({ value, className }: { value: string | null; className?: string }) {
  const doubleTapModifier = value?.startsWith("DoubleTap:") ? value.slice(10) : null;
  const doubleTap = Boolean(doubleTapModifier);
  const label = doubleTapModifier ? `Double-tap ${doubleTapModifier}` : (value ?? "Not set");
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={label}>
      {shortcutTokens(value).map((token, index) => (
        <span key={`${token}-${index}`} className="inline-flex items-center gap-1">
          {doubleTap && index === 1 ? (
            <span className="text-[10px] text-[var(--subtle)]">then</span>
          ) : null}
          <kbd className="min-w-6 rounded-md border border-[var(--border)] bg-[var(--key)] px-1.5 py-0.5 text-center font-sans text-[10px] font-medium leading-4 text-[var(--muted-text)] shadow-[0_1px_0_var(--border)]">
            {token}
          </kbd>
        </span>
      ))}
    </span>
  );
}
