import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  CheckCircle2,
  Clipboard,
  CopyCheck,
  GripVertical,
  Merge,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Card, Section } from "../types";
import { cn, formatCapturedAt } from "../lib/utils";

interface CardItemProps {
  card: Card;
  sections: Section[];
  selected: boolean;
  focused: boolean;
  selectedCount: number;
  completionTarget: boolean;
  editing: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onFocus: () => void;
  onToggleCompleted: () => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  onSave: (content: string) => Card | void | Promise<Card | void>;
  onError: (error: unknown) => void;
  onCopy: (complete: boolean) => void | Promise<void>;
  onMerge: () => void | Promise<void>;
  onMove: (sectionId: string | null) => void | Promise<void>;
  onDelete: () => void;
}

export interface CardItemHandle {
  commit: () => Promise<Card | undefined>;
}

const itemClass =
  "flex h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-[var(--muted)]";

export const CardItem = forwardRef<CardItemHandle, CardItemProps>(function CardItem(
  {
    card,
    sections,
    selected,
    focused,
    selectedCount,
    completionTarget,
    editing,
    onSelect,
    onFocus,
    onToggleCompleted,
    onBeginEdit,
    onEndEdit,
    onSave,
    onError,
    onCopy,
    onMerge,
    onMove,
    onDelete,
  },
  ref,
) {
  const [draft, setDraft] = useState(card.content);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const commitPromiseRef = useRef<Promise<Card | undefined> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  useEffect(() => {
    if (editing) {
      editorRef.current?.focus();
      editorRef.current?.select();
    }
  }, [editing]);

  async function commitDraft(): Promise<Card | undefined> {
    const next = draft.trim();
    let updated: Card | void;
    if (next && next !== card.content) {
      savingRef.current = true;
      setSaving(true);
      if (editorRef.current) editorRef.current.disabled = true;
      try {
        updated = await onSave(next);
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (editorRef.current) editorRef.current.disabled = false;
      }
    } else {
      setDraft(card.content);
      updated = undefined;
    }
    onEndEdit();
    if (updated) return updated;
    return undefined;
  }

  async function commit(): Promise<Card | undefined> {
    if (commitPromiseRef.current) return commitPromiseRef.current;
    if (savingRef.current) return undefined;
    const operation = commitDraft();
    commitPromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (commitPromiseRef.current === operation) commitPromiseRef.current = null;
    }
  }

  useImperativeHandle(ref, () => ({ commit }));

  const source = [card.sourceProcess, card.sourceWindowTitle].filter(Boolean).join(" · ");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-card-id={card.id}
      data-selected={selected || undefined}
      tabIndex={focused ? 0 : -1}
      role="listitem"
      onFocus={onFocus}
      onClick={onSelect}
      onDoubleClick={onBeginEdit}
      className={cn(
        "card group relative flex min-h-[64px] scroll-m-3 items-start gap-2 rounded-[20px] border bg-[var(--card)] px-3 py-3 text-[var(--text)] shadow-[var(--shadow-card)] outline-none transition-[border-color,box-shadow,background-color,opacity]",
        selected
          ? "border-[var(--accent)] bg-[var(--card-selected)] shadow-[0_0_0_1px_var(--accent),var(--shadow-card)]"
          : "border-[var(--border-soft)] hover:border-[var(--border)]",
        focused && "ring-2 ring-[var(--accent-ring)] ring-offset-1 ring-offset-transparent",
        isDragging && "z-50 opacity-75 shadow-[var(--shadow-dialog)]",
        card.completed && !selected && "bg-[var(--card-complete)]",
      )}
    >
      {selected ? <span className="sr-only">Selected card.</span> : null}
      <button
        className={cn(
          "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border outline-none transition-[border-color,background-color,color,transform] hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          card.completed
            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
            : "border-[var(--check-border)] text-transparent hover:border-[var(--accent)]",
        )}
        aria-label={completionTarget ? "Mark as done" : "Mark as open"}
        aria-pressed={card.completed}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCompleted();
        }}
      >
        <Check className="size-3.5" strokeWidth={2.5} />
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <textarea
            ref={editorRef}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={() => void commit().catch(onError)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(card.content);
                onEndEdit();
              } else if (event.key === "Enter" && event.ctrlKey) {
                event.preventDefault();
                void commit().catch(onError);
              }
            }}
            className="min-h-12 w-full resize-none rounded-lg bg-transparent text-[13px] leading-[19px] outline-none ring-0"
            aria-label="Edit card"
          />
        ) : (
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[13px] font-[450] leading-[19px] tracking-[-0.004em]",
              card.completed && "text-[var(--muted-text)] line-through decoration-[var(--subtle)]",
            )}
          >
            {card.content}
          </p>
        )}
        {source ? (
          <p
            className="mt-1.5 truncate text-[10px] text-[var(--subtle)]"
            title={`${source} · ${new Date(card.createdAt).toLocaleString()}`}
          >
            {source} · {formatCapturedAt(card.createdAt)}
          </p>
        ) : null}
      </div>

      {!editing ? (
        <div className="-mr-1 -mt-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected=true]:opacity-100">
          <button
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            className="cursor-grab rounded-md p-1 text-[var(--subtle)] outline-none hover:bg-[var(--muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:cursor-grabbing"
            aria-label="Drag to reorder card"
          >
            <GripVertical className="size-3.5" />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                onClick={(event) => event.stopPropagation()}
                className="rounded-md p-1 text-[var(--subtle)] outline-none hover:bg-[var(--muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Card actions"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="menu-content z-[80] min-w-56 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-[var(--text)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenu.Item className={itemClass} onSelect={() => void onCopy(false)}>
                  <Clipboard className="size-4 text-[var(--subtle)]" /> Copy
                  <span className="ml-auto text-[10px] text-[var(--subtle)]">Ctrl C</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item className={itemClass} onSelect={() => void onCopy(true)}>
                  <CopyCheck className="size-4 text-[var(--subtle)]" /> Copy & complete
                </DropdownMenu.Item>
                <DropdownMenu.Item className={itemClass} onSelect={onToggleCompleted}>
                  <CheckCircle2 className="size-4 text-[var(--subtle)]" />
                  {completionTarget ? "Mark as done" : "Mark as open"}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-soft)]" />
                <DropdownMenu.Item className={itemClass} onSelect={onBeginEdit}>
                  <Pencil className="size-4 text-[var(--subtle)]" /> Edit
                  <span className="ml-auto text-[10px] text-[var(--subtle)]">F2</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={itemClass}
                  disabled={selectedCount < 2}
                  onSelect={() => void onMerge()}
                >
                  <Merge className="size-4 text-[var(--subtle)]" /> Merge selected
                </DropdownMenu.Item>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={itemClass}>
                    <MoveRight className="size-4 text-[var(--subtle)]" /> Move to
                    <span className="ml-auto">›</span>
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                      sideOffset={6}
                      className="menu-content z-[81] min-w-48 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-[var(--text)] shadow-[var(--shadow-popover)]"
                    >
                      <DropdownMenu.Item className={itemClass} onSelect={() => void onMove(null)}>
                        Inbox
                      </DropdownMenu.Item>
                      {sections.map((section) => (
                        <DropdownMenu.Item
                          key={section.id}
                          className={itemClass}
                          onSelect={() => void onMove(section.id)}
                        >
                          <span className="max-w-40 truncate">{section.name}</span>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-soft)]" />
                <DropdownMenu.Item
                  className={cn(itemClass, "text-[var(--danger)]")}
                  onSelect={onDelete}
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      ) : null}
    </div>
  );
});
