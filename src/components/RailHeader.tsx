import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  MoreHorizontal,
  Palette,
  Search,
  Trash2,
  X,
  Keyboard,
} from "lucide-react";
import type { Section } from "../types";
import { cn } from "../lib/utils";

interface RailHeaderProps {
  query: string;
  setQuery: (query: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  sectionId: string | "all";
  sections: Section[];
  setSectionId: (id: string | "all") => void;
  onAppearance: () => void;
  onKeybindings: () => void;
  onClear: () => void;
}

const menuItem =
  "flex h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-[var(--muted)] data-[highlighted]:text-[var(--text)]";

export function RailHeader({
  query,
  setQuery,
  searchRef,
  sectionId,
  sections,
  setSectionId,
  onAppearance,
  onKeybindings,
  onClear,
}: RailHeaderProps) {
  const currentSection = sections.find((section) => section.id === sectionId);
  return (
    <header className="relative z-30 shrink-0 px-3 pb-2 pt-3" data-tauri-drag-region>
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <div className="group flex h-11 min-w-0 flex-1 items-center rounded-2xl border border-[var(--border-soft)] bg-[var(--input)] px-3 shadow-[var(--shadow-input)] transition-shadow focus-within:ring-2 focus-within:ring-[var(--accent-ring)]">
          <Search className="mr-2 size-4 shrink-0 text-[var(--subtle)]" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search cards"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--subtle)]"
          />
          {query ? (
            <button
              className="rounded-md p-1 text-[var(--subtle)] hover:bg-[var(--muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="ml-1 flex max-w-[104px] items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-text)] outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label={`Filter by section. Current: ${currentSection?.name ?? "All"}`}
              >
                <span className="truncate">{currentSection?.name ?? "All"}</span>
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={8}
                align="end"
                className="menu-content z-[80] min-w-52 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-[var(--text)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
              >
                <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--subtle)]">
                  Section
                </DropdownMenu.Label>
                {[
                  { id: "all", name: "All cards" },
                  { id: "inbox", name: "Inbox" },
                  ...sections,
                ].map((section) => {
                  const value = section.id === "inbox" ? "" : section.id;
                  const selected = (sectionId === "all" ? "all" : sectionId) === value;
                  return (
                    <DropdownMenu.Item
                      key={section.id}
                      className={cn(menuItem, "justify-between")}
                      onSelect={() => setSectionId(value as string | "all")}
                    >
                      <span className="max-w-44 truncate">{section.name}</span>
                      {selected ? <Check className="size-3.5 text-[var(--accent)]" /> : null}
                    </DropdownMenu.Item>
                  );
                })}
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-soft)]" />
                <div className="px-2 py-1 text-[10px] text-[var(--subtle)]">
                  Type <kbd># Section Name</kbd> below to add one.
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--input)] text-[var(--muted-text)] shadow-[var(--shadow-input)] outline-none transition-colors hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Open Cairn menu"
            >
              <MoreHorizontal className="size-[19px]" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={8}
              align="end"
              className="menu-content z-[80] min-w-52 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-[var(--text)] shadow-[var(--shadow-popover)] backdrop-blur-xl"
            >
              <DropdownMenu.Item className={menuItem} onSelect={onAppearance}>
                <Palette className="size-4 text-[var(--subtle)]" /> Appearance
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItem} onSelect={onKeybindings}>
                <Keyboard className="size-4 text-[var(--subtle)]" /> Keybindings
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-soft)]" />
              <DropdownMenu.Item
                className={cn(
                  menuItem,
                  "text-[var(--danger)] data-[highlighted]:text-[var(--danger)]",
                )}
                onSelect={onClear}
              >
                <Trash2 className="size-4" /> Clear
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
