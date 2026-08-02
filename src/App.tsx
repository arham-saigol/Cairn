import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FilePlus2, SearchX, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bootstrap,
  captureSelection,
  clearAll,
  copyText,
  createNote,
  createSection,
  deleteCards,
  hideRail,
  mergeCards,
  moveCards,
  onFocusNewCard,
  onGlobalShortcut,
  quitApp,
  rememberPreviousWindow,
  reorderCards,
  restoreBackup,
  restorePreviousWindow,
  saveSettings,
  setCardsCompleted,
  showRail,
  toggleRail,
  updateCardContent,
} from "./api";
import { CardItem, type CardItemHandle } from "./components/CardItem";
import { Composer, SECTION_INPUT_PATTERN } from "./components/Composer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { RailHeader } from "./components/RailHeader";
import { SectionPickerDialog } from "./components/SectionPickerDialog";
import { ToastRegion, type ToastState } from "./components/ToastRegion";
import { shortcutMatches } from "./lib/keybindings";
import { copyBlock, isEditableTarget } from "./lib/utils";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Card,
  type GlobalShortcutEvent,
  type Section,
} from "./types";

type SettingsTab = "appearance" | "keybindings";

const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);

export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const toastId = useRef(0);
  const cardRefs = useRef(new Map<string, CardItemHandle>());
  const composerSubmitting = useRef(false);
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveSequence = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const snapshot = await bootstrap();
      setCards(snapshot.cards.sort((a, b) => a.sortOrder - b.sortOrder));
      setSections(snapshot.sections.sort((a, b) => a.sortOrder - b.sortOrder));
      setSettings(snapshot.settings);
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return cards.filter((card) => {
      const inSection =
        sectionId === null ||
        (sectionId === "" ? card.sectionId === null : card.sectionId === sectionId);
      if (!inSection) return false;
      if (!needle) return true;
      const sectionName =
        sections.find((section) => section.id === card.sectionId)?.name ?? "Inbox";
      return `${card.content} ${card.sourceProcess ?? ""} ${card.sourceWindowTitle ?? ""} ${sectionName}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [cards, query, sectionId, sections]);

  const groups = useMemo(() => {
    if (sectionId !== null) {
      const name =
        sectionId === ""
          ? "Inbox"
          : (sections.find((section) => section.id === sectionId)?.name ?? "Section");
      return [{ id: sectionId || "inbox", name, cards: visibleCards }];
    }
    const ordered = [
      { id: "inbox", name: "Inbox", sectionId: null as string | null },
      ...sections.map((section) => ({ id: section.id, name: section.name, sectionId: section.id })),
    ];
    return ordered
      .map((group) => ({
        id: group.id,
        name: group.name,
        cards: visibleCards.filter((card) => card.sectionId === group.sectionId),
      }))
      .filter((group) => group.cards.length > 0);
  }, [sectionId, sections, visibleCards]);

  const renderedCards = useMemo(() => groups.flatMap((group) => group.cards), [groups]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!renderedCards.some((card) => card.id === focused))
        setFocused(renderedCards[0]?.id ?? null);
      setSelected(
        (current) =>
          new Set([...current].filter((id) => renderedCards.some((card) => card.id === id))),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [renderedCards, focused]);

  useEffect(() => {
    const root = document.documentElement;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        settings.appearance.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.appearance.theme;
      root.dataset.theme = resolved;
      root.dataset.accent = settings.appearance.accent;
      root.style.setProperty("--panel-opacity", `${settings.appearance.opacity}%`);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.appearance]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.actionLabel ? 7000 : 3600,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string, options?: Omit<ToastState, "id" | "message">) => {
    setToast({ id: ++toastId.current, message, ...options });
  }, []);

  const showError = useCallback(
    (error: unknown) => {
      notify(error instanceof Error ? error.message : String(error), { kind: "info" });
    },
    [notify],
  );

  function actionIds(cardId?: string) {
    const orderedSelection = renderedCards
      .filter((card) => selected.has(card.id))
      .map((card) => card.id);
    if (cardId && selected.has(cardId)) return orderedSelection;
    if (cardId) return [cardId];
    if (orderedSelection.length) return orderedSelection;
    return focused ? [focused] : [];
  }

  const copyCards = useCallback(
    async (complete: boolean, returnFocus: boolean, forcedIds?: string[]) => {
      try {
        if (returnFocus) await rememberPreviousWindow();
        const ids = forcedIds ?? (selected.size ? [...selected] : focused ? [focused] : []);
        const requested = new Set(ids);
        let copySource = renderedCards;
        if (editing) {
          const updated = await cardRefs.current.get(editing)?.commit();
          if (updated) {
            copySource = renderedCards.map((card) => (card.id === updated.id ? updated : card));
          }
        }
        const ordered = copySource.filter((card) => requested.has(card.id));
        const text = copyBlock(ordered);
        if (!text) {
          notify("Select at least one card to copy.", { kind: "info" });
          return;
        }
        await copyText(text);
        let changed: string[] = [];
        if (complete) {
          changed = await setCardsCompleted(ids, true);
          setCards((current) =>
            current.map((card) =>
              changed.includes(card.id) ? { ...card, completed: true } : card,
            ),
          );
        }
        notify(`Copied ${ordered.length === 1 ? "1 card" : `${ordered.length} cards`}`, {
          actionLabel: changed.length ? "Undo" : undefined,
          onAction: changed.length
            ? async () => {
                await setCardsCompleted(changed, false);
                setCards((current) =>
                  current.map((card) =>
                    changed.includes(card.id) ? { ...card, completed: false } : card,
                  ),
                );
              }
            : undefined,
        });
        if (returnFocus) await restorePreviousWindow();
      } catch (error) {
        showError(error);
      }
    },
    [editing, focused, notify, renderedCards, selected, showError],
  );

  function applySettings(next: AppSettings) {
    setSettings(next);
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    const sequence = ++settingsSaveSequence.current;
    settingsSaveTimer.current = setTimeout(() => {
      void saveSettings(next).catch(async (error) => {
        if (sequence !== settingsSaveSequence.current) return;
        showError(error);
        try {
          const snapshot = await bootstrap();
          setSettings(snapshot.settings);
        } catch {
          // Preserve the in-memory view if even reloading local settings fails.
        }
      });
    }, 100);
  }

  async function submitComposer() {
    if (composerSubmitting.current) return;
    const submittedDraft = composer;
    const value = submittedDraft.trim();
    if (!value) return;
    composerSubmitting.current = true;
    try {
      if (SECTION_INPUT_PATTERN.test(value)) {
        const section = await createSection(value.replace(/^#\s+/, ""));
        setSections((current) => [...current, section]);
        setSectionId(section.id);
        setComposer((current) => (current === submittedDraft ? "" : current));
        notify(`Created ${section.name}`, { kind: "success" });
      } else {
        const targetSection = sectionId === null || sectionId === "" ? null : sectionId;
        const card = await createNote(value, targetSection);
        setCards((current) => [...current, card]);
        setComposer((current) => (current === submittedDraft ? "" : current));
        setSelected(new Set([card.id]));
        setAnchor(card.id);
        setFocused(card.id);
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    } catch (error) {
      showError(error);
    } finally {
      composerSubmitting.current = false;
    }
  }

  function selectCard(cardId: string, event: React.MouseEvent) {
    const index = renderedCards.findIndex((card) => card.id === cardId);
    if (event.shiftKey && anchor) {
      const anchorIndex = renderedCards.findIndex((card) => card.id === anchor);
      if (anchorIndex >= 0) {
        const [start, end] = [anchorIndex, index].sort((a, b) => a - b);
        setSelected(new Set(renderedCards.slice(start, end + 1).map((card) => card.id)));
      }
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
        return next;
      });
      setAnchor(cardId);
    } else {
      setSelected(new Set([cardId]));
      setAnchor(cardId);
    }
    setFocused(cardId);
  }

  async function toggleComplete(ids: string[]) {
    const relevant = cards.filter((card) => ids.includes(card.id));
    const completed = !relevant.every((card) => card.completed);
    try {
      const changed = await setCardsCompleted(ids, completed);
      setCards((current) =>
        current.map((card) => (changed.includes(card.id) ? { ...card, completed } : card)),
      );
    } catch (error) {
      showError(error);
    }
  }

  async function doMerge() {
    const ids = actionIds();
    if (ids.length < 2) return notify("Select two or more cards to merge.", { kind: "info" });
    try {
      const merged = await mergeCards(ids);
      setCards((current) =>
        [...current.filter((card) => !ids.includes(card.id)), merged].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        ),
      );
      setSelected(new Set([merged.id]));
      setFocused(merged.id);
      setAnchor(merged.id);
      notify(`Merged ${ids.length} cards`);
    } catch (error) {
      showError(error);
    }
  }

  async function doMove(ids: string[], target: string | null) {
    try {
      await moveCards(ids, target);
      setCards((current) =>
        current.map((card) => (ids.includes(card.id) ? { ...card, sectionId: target } : card)),
      );
      notify(`Moved ${ids.length === 1 ? "card" : `${ids.length} cards`}`);
    } catch (error) {
      showError(error);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = cards.findIndex((card) => card.id === active.id);
    const newIndex = cards.findIndex((card) => card.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (cards[oldIndex].sectionId !== cards[newIndex].sectionId) return;
    const next = arrayMove(cards, oldIndex, newIndex).map((card, sortOrder) => ({
      ...card,
      sortOrder,
    }));
    void reorderCards(next.map((card) => card.id))
      .then(() => setCards(next))
      .catch(showError);
  }

  async function confirmDelete() {
    if (!deleteTarget?.length) return;
    try {
      await deleteCards(deleteTarget);
      setCards((current) => current.filter((card) => !deleteTarget.includes(card.id)));
      setSelected(new Set());
      setDeleteTarget(null);
      notify(`Deleted ${deleteTarget.length === 1 ? "1 card" : `${deleteTarget.length} cards`}`);
    } catch (error) {
      showError(error);
    }
  }

  async function confirmClear() {
    try {
      const backupId = await clearAll();
      setCards([]);
      setSections([]);
      setSelected(new Set());
      setSectionId(null);
      setClearOpen(false);
      notify("Cairn content cleared", {
        actionLabel: "Restore",
        onAction: async () => {
          const snapshot = await restoreBackup(backupId);
          setCards(snapshot.cards.sort((a, b) => a.sortOrder - b.sortOrder));
          setSections(snapshot.sections.sort((a, b) => a.sortOrder - b.sortOrder));
        },
      });
    } catch (error) {
      showError(error);
    }
  }

  const handleKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || settingsOpen || deleteTarget || clearOpen || moveOpen) return;

    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      composerRef.current?.focus();
      return;
    }

    if (isEditableTarget(event.target)) {
      if (event.key === "Escape" && event.target === searchRef.current && query) {
        event.preventDefault();
        setQuery("");
      }
      return;
    }

    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyCards(event.shiftKey, false);
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelected(new Set(renderedCards.map((card) => card.id)));
      setAnchor(renderedCards[0]?.id ?? null);
      return;
    }
    if (shortcutMatches(event, settings.appShortcuts.mergeSelected)) {
      event.preventDefault();
      void doMerge();
      return;
    }
    if (shortcutMatches(event, settings.appShortcuts.editFocused)) {
      event.preventDefault();
      if (focused) setEditing(focused);
      return;
    }
    if (shortcutMatches(event, settings.appShortcuts.moveToSection)) {
      event.preventDefault();
      if (actionIds().length) setMoveOpen(true);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const ids = actionIds();
      if (ids.length) setDeleteTarget(ids);
      return;
    }
    if (event.key === " " && !event.repeat) {
      event.preventDefault();
      const ids = actionIds();
      if (ids.length) void toggleComplete(ids);
      return;
    }
    if (event.key === "Enter" && focused) {
      event.preventDefault();
      setEditing(focused);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const currentIndex = Math.max(
        0,
        renderedCards.findIndex((card) => card.id === focused),
      );
      const nextIndex = Math.min(renderedCards.length - 1, Math.max(0, currentIndex + direction));
      const next = renderedCards[nextIndex];
      if (!next) return;
      setFocused(next.id);
      if (event.shiftKey) {
        const anchorId = anchor ?? renderedCards[currentIndex]?.id ?? next.id;
        const anchorIndex = renderedCards.findIndex((card) => card.id === anchorId);
        const [start, end] = [anchorIndex, nextIndex].sort((a, b) => a - b);
        setAnchor(anchorId);
        setSelected(new Set(renderedCards.slice(start, end + 1).map((card) => card.id)));
      } else {
        setSelected(new Set([next.id]));
        setAnchor(next.id);
      }
      requestAnimationFrame(() => {
        const node = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next.id)}"]`);
        node?.focus();
        node?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (editing) setEditing(null);
      else if (selected.size) setSelected(new Set());
      else void hideRail();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  const handleGlobalAction = useEffectEvent((event: GlobalShortcutEvent) => {
    if (settingsOpen) return;
    switch (event.action) {
      case "showHide":
        void toggleRail();
        break;
      case "captureSelection":
        void captureSelection()
          .then((card) => {
            setCards((current) => [...current, card]);
            setSelected(new Set([card.id]));
            setFocused(card.id);
            return showRail(false);
          })
          .then(() => notify("Captured selection"))
          .catch(showError);
        break;
      case "openNewCard":
        void showRail(true).then(() => requestAnimationFrame(() => composerRef.current?.focus()));
        break;
      case "copyReturn":
        void copyCards(false, true);
        break;
      case "copyCompleteReturn":
        void copyCards(true, true);
        break;
      case "toggleAlwaysOnTop":
        if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
        settingsSaveSequence.current += 1;
        {
          const next = { ...settings, alwaysOnTop: !settings.alwaysOnTop };
          void saveSettings(next)
            .then((saved) => {
              setSettings(saved);
              notify(saved.alwaysOnTop ? "Cairn is always on top" : "Always on top is off");
            })
            .catch(async (error) => {
              showError(error);
              try {
                const snapshot = await bootstrap();
                setSettings(snapshot.settings);
              } catch {
                // Keep the latest in-memory settings if the database cannot be reloaded.
              }
            });
        }
        break;
      case "clearAll":
        void showRail(false).then(() => setClearOpen(true));
        break;
    }
  });

  useEffect(() => {
    let disposed = false;
    let unlistenShortcut: () => void = () => {};
    let unlistenFocus: () => void = () => {};
    void onGlobalShortcut(handleGlobalAction).then((dispose) => {
      if (disposed) dispose();
      else unlistenShortcut = dispose;
    });
    void onFocusNewCard(() => requestAnimationFrame(() => composerRef.current?.focus())).then(
      (dispose) => {
        if (disposed) dispose();
        else unlistenFocus = dispose;
      },
    );
    return () => {
      disposed = true;
      unlistenShortcut();
      unlistenFocus();
    };
  }, []);

  if (fatalError) {
    return (
      <main className="rail-shell flex h-full items-center justify-center p-6 text-center text-[var(--text)]">
        <div>
          <FilePlus2 className="mx-auto size-7 text-[var(--danger)]" />
          <h1 className="mt-3 text-sm font-semibold">Cairn could not open its local data</h1>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-text)]">{fatalError}</p>
          <button
            className="mt-4 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const activeSectionName =
    sectionId === null || sectionId === ""
      ? undefined
      : sections.find((section) => section.id === sectionId)?.name;

  return (
    <main className="rail-shell relative flex h-full select-none flex-col overflow-hidden text-[var(--text)]">
      <RailHeader
        query={query}
        setQuery={setQuery}
        searchRef={searchRef}
        sectionId={sectionId}
        sections={sections}
        setSectionId={(id) => {
          setSectionId(id);
          setSelected(new Set());
        }}
        onAppearance={() => {
          setSettingsTab("appearance");
          setSettingsOpen(true);
        }}
        onKeybindings={() => {
          setSettingsTab("keybindings");
          setSettingsOpen(true);
        }}
        onClear={() => setClearOpen(true)}
        onQuit={() => void quitApp().catch(showError)}
      />

      <section
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2"
        aria-label="Cards"
        role="listbox"
        aria-multiselectable="true"
      >
        {loading ? (
          <div className="space-y-3 pt-7" aria-label="Loading cards">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-20 animate-pulse rounded-[20px] border border-[var(--border-soft)] bg-[var(--card)] opacity-60"
              />
            ))}
          </div>
        ) : visibleCards.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={renderedCards.map((card) => card.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="pb-3">
                {groups.map((group) => (
                  <section key={group.id} className="mb-4" aria-labelledby={`section-${group.id}`}>
                    <div className="mb-2 flex items-center gap-2 px-2">
                      <h2
                        id={`section-${group.id}`}
                        className="max-w-[70%] truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted-text)]"
                      >
                        {group.name}
                      </h2>
                      <span className="h-px flex-1 bg-[var(--border-soft)]" />
                      <span className="text-[9px] tabular-nums text-[var(--subtle)]">
                        {group.cards.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <AnimatePresence initial={false}>
                        {group.cards.map((card) => {
                          const ids = actionIds(card.id);
                          return (
                            <motion.div
                              key={card.id}
                              layout="position"
                              initial={{ opacity: 0, y: 6, scale: 0.985 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, height: 0, marginTop: 0, scale: 0.98 }}
                              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                            >
                              <CardItem
                                key={card.updatedAt}
                                ref={(handle) => {
                                  if (handle) cardRefs.current.set(card.id, handle);
                                  else cardRefs.current.delete(card.id);
                                }}
                                card={card}
                                sections={sections}
                                selected={selected.has(card.id)}
                                focused={focused === card.id}
                                selectedCount={selected.size}
                                editing={editing === card.id}
                                onSelect={(event) => selectCard(card.id, event)}
                                onFocus={() => setFocused(card.id)}
                                onToggleCompleted={() => void toggleComplete(ids)}
                                onBeginEdit={() => setEditing(card.id)}
                                onEndEdit={() => setEditing(null)}
                                onSave={async (content) => {
                                  const updated = await updateCardContent(card.id, content);
                                  setCards((current) =>
                                    current.map((item) => (item.id === card.id ? updated : item)),
                                  );
                                  return updated;
                                }}
                                onError={showError}
                                onCopy={(complete) => copyCards(complete, false, ids)}
                                onMerge={doMerge}
                                onMove={(target) => doMove(ids, target)}
                                onDelete={() => setDeleteTarget(ids)}
                              />
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </section>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center px-7 pb-10 text-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-[var(--muted)] text-[var(--subtle)]">
                {query ? <SearchX className="size-5" /> : <Sparkles className="size-5" />}
              </div>
              <h2 className="mt-3 text-sm font-semibold">
                {query ? "Nothing found" : "A clear place to begin"}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--subtle)]">
                {query
                  ? "Try another search or switch sections."
                  : "Add a note below, or use the capture shortcut while text is selected in another app."}
              </p>
            </motion.div>
          </div>
        )}
      </section>

      <Composer
        value={composer}
        setValue={setComposer}
        inputRef={composerRef}
        onSubmit={submitComposer}
        sectionName={activeSectionName}
      />

      <ToastRegion toast={toast} dismiss={() => setToast(null)} onActionError={showError} />
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            initialTab={settingsTab}
            settings={settings}
            onOpenChange={setSettingsOpen}
            onChange={applySettings}
          />
        </Suspense>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        variant="delete"
        count={deleteTarget?.length}
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        variant="clear"
        onConfirm={confirmClear}
      />
      <SectionPickerDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        sections={sections}
        count={actionIds().length}
        onMove={(target) => doMove(actionIds(), target)}
      />
    </main>
  );
}
