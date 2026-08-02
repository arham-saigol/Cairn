import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Card,
  type GlobalShortcutEvent,
  type Section,
  type Snapshot,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = Boolean(window.__TAURI_INTERNALS__);
const STORAGE_KEY = "cairn-browser-preview-v1";

const now = new Date().toISOString();
const demoSnapshot: Snapshot = {
  sections: [
    { id: "research", name: "Research", sortOrder: 0, createdAt: now },
    { id: "configuration", name: "Configuration formats", sortOrder: 1, createdAt: now },
  ],
  cards: [
    {
      id: "one",
      content:
        "Negation in inherited configs. The moment a config can extend a base or preset, someone needs to remove an extension.",
      completed: false,
      sectionId: "research",
      sortOrder: 0,
      sourceProcess: "Visual Studio Code",
      sourceWindowTitle: "architecture.md — cairn",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "two",
      content: "Use TOML as the default declarative format, backed by a published schema.",
      completed: false,
      sectionId: "configuration",
      sortOrder: 1,
      sourceProcess: null,
      sourceWindowTitle: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "three",
      content:
        "Keep the core configuration declarative even if you later add an optional TypeScript escape hatch.",
      completed: false,
      sectionId: "configuration",
      sortOrder: 2,
      sourceProcess: null,
      sourceWindowTitle: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  settings: structuredClone(DEFAULT_SETTINGS),
};

let mockState: Snapshot = loadMock();
let lastBackup: Snapshot | null = null;

function loadMock(): Snapshot {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Snapshot;
  } catch {
    // A locked-down preview may not expose localStorage.
  }
  return new URLSearchParams(location.search).has("demo")
    ? structuredClone(demoSnapshot)
    : { cards: [], sections: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

function persistMock() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockState));
  } catch {
    // The desktop build never relies on this path.
  }
}

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args);
}

export async function bootstrap(): Promise<Snapshot> {
  if (isTauri) return command<Snapshot>("bootstrap");
  return structuredClone(mockState);
}

export async function createNote(content: string, sectionId: string | null): Promise<Card> {
  if (isTauri) return command<Card>("create_note", { content, sectionId });
  const stamp = new Date().toISOString();
  const card: Card = {
    id: makeId(),
    content: content.trim(),
    sectionId,
    completed: false,
    sortOrder: mockState.cards.length,
    sourceProcess: null,
    sourceWindowTitle: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  mockState.cards.push(card);
  persistMock();
  return structuredClone(card);
}

export async function createSection(name: string): Promise<Section> {
  if (isTauri) return command<Section>("create_section", { name });
  const section: Section = {
    id: makeId(),
    name: name.trim(),
    sortOrder: mockState.sections.length,
    createdAt: new Date().toISOString(),
  };
  mockState.sections.push(section);
  persistMock();
  return structuredClone(section);
}

export async function updateCardContent(id: string, content: string): Promise<Card> {
  if (isTauri) return command<Card>("update_card_content", { id, content });
  const card = mockState.cards.find((item) => item.id === id)!;
  card.content = content.trim();
  card.updatedAt = new Date().toISOString();
  persistMock();
  return structuredClone(card);
}

export async function setCardsCompleted(ids: string[], completed: boolean): Promise<string[]> {
  if (isTauri) return command<string[]>("set_cards_completed", { ids, completed });
  const changed = mockState.cards
    .filter((card) => ids.includes(card.id) && card.completed !== completed)
    .map((card) => card.id);
  mockState.cards.forEach((card) => {
    if (changed.includes(card.id)) card.completed = completed;
  });
  persistMock();
  return changed;
}

export async function deleteCards(ids: string[]) {
  if (isTauri) return command<void>("delete_cards", { ids });
  mockState.cards = mockState.cards.filter((card) => !ids.includes(card.id));
  persistMock();
}

export async function mergeCards(ids: string[]): Promise<Card> {
  if (isTauri) return command<Card>("merge_cards", { ids });
  const selected = mockState.cards
    .filter((card) => ids.includes(card.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const first = selected[0];
  const merged: Card = {
    ...first,
    content: selected.map((card) => card.content.trim()).join("\n\n"),
    completed: selected.every((card) => card.completed),
    updatedAt: new Date().toISOString(),
  };
  mockState.cards = mockState.cards.filter((card) => !ids.includes(card.id));
  mockState.cards.push(merged);
  mockState.cards.sort((a, b) => a.sortOrder - b.sortOrder);
  persistMock();
  return structuredClone(merged);
}

export async function moveCards(ids: string[], sectionId: string | null) {
  if (isTauri) return command<void>("move_cards", { ids, sectionId });
  mockState.cards.forEach((card) => {
    if (ids.includes(card.id)) card.sectionId = sectionId;
  });
  persistMock();
}

export async function reorderCards(ids: string[]) {
  if (isTauri) return command<void>("reorder_cards", { ids });
  const order = new Map(ids.map((id, index) => [id, index]));
  mockState.cards.forEach((card) => {
    if (order.has(card.id)) card.sortOrder = order.get(card.id)!;
  });
  mockState.cards.sort((a, b) => a.sortOrder - b.sortOrder);
  persistMock();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (isTauri) return command<AppSettings>("save_settings", { settings });
  mockState.settings = structuredClone(settings);
  persistMock();
  return structuredClone(settings);
}

export async function copyText(text: string) {
  if (isTauri) return command<void>("copy_text", { text });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The clipboard is not available in this preview.");
  }
}

export async function clearAll(): Promise<string> {
  if (isTauri) return command<string>("clear_all");
  lastBackup = structuredClone(mockState);
  mockState.cards = [];
  mockState.sections = [];
  persistMock();
  return "browser-backup";
}

export async function restoreBackup(id: string): Promise<Snapshot> {
  if (isTauri) return command<Snapshot>("restore_backup", { id });
  if (!lastBackup) throw new Error("The local backup is no longer available.");
  mockState = structuredClone(lastBackup);
  persistMock();
  return structuredClone(mockState);
}

export async function captureSelection(): Promise<Card> {
  if (isTauri) return command<Card>("capture_selection");
  const card = await createNote("Captured text appears here in the browser preview.", null);
  card.sourceProcess = "Preview app";
  card.sourceWindowTitle = "Cairn interaction preview";
  mockState.cards = mockState.cards.map((item) => (item.id === card.id ? card : item));
  persistMock();
  return card;
}

export async function showRail(focusInput = false) {
  if (isTauri) return command<void>("show_rail", { focusInput });
}

export async function toggleRail() {
  if (isTauri) return command<void>("toggle_rail");
}

export async function hideRail() {
  if (isTauri) return command<void>("hide_rail");
}

export async function restorePreviousWindow() {
  if (isTauri) return command<void>("restore_previous_window");
}

export async function toggleAlwaysOnTop(): Promise<boolean> {
  if (isTauri) return command<boolean>("toggle_always_on_top");
  mockState.settings.alwaysOnTop = !mockState.settings.alwaysOnTop;
  persistMock();
  return mockState.settings.alwaysOnTop;
}

export async function onGlobalShortcut(
  handler: (event: GlobalShortcutEvent) => void,
): Promise<UnlistenFn> {
  if (isTauri) {
    return listen<GlobalShortcutEvent>("global-shortcut", ({ payload }) => handler(payload));
  }
  return () => undefined;
}

export async function onFocusNewCard(handler: () => void): Promise<UnlistenFn> {
  if (isTauri) return listen("focus-new-card", handler);
  return () => undefined;
}
