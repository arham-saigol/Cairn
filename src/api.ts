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
const BACKUP_KEY = "cairn-browser-preview-backup-v1";

export function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is optional in locked-down browser previews.
  }
}

export function removeStorageValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is optional in locked-down browser previews.
  }
}

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
let lastBackup: Snapshot | null = loadStoredSnapshot(BACKUP_KEY);

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Snapshot>;
  return (
    Array.isArray(candidate.cards) &&
    candidate.cards.every(
      (card) =>
        card &&
        typeof card.id === "string" &&
        typeof card.content === "string" &&
        typeof card.completed === "boolean" &&
        (card.sectionId === null || typeof card.sectionId === "string") &&
        typeof card.sortOrder === "number" &&
        (card.sourceProcess === null || typeof card.sourceProcess === "string") &&
        (card.sourceWindowTitle === null || typeof card.sourceWindowTitle === "string") &&
        typeof card.createdAt === "string" &&
        typeof card.updatedAt === "string",
    ) &&
    Array.isArray(candidate.sections) &&
    candidate.sections.every(
      (section) =>
        section &&
        typeof section.id === "string" &&
        typeof section.name === "string" &&
        typeof section.sortOrder === "number" &&
        typeof section.createdAt === "string",
    ) &&
    isSettings(candidate.settings)
  );
}

function isSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<AppSettings>;
  const appearance = settings.appearance;
  const validShortcutMap = (candidate: unknown, keys: string[]) =>
    Boolean(
      candidate &&
      typeof candidate === "object" &&
      keys.every((key) => {
        const shortcut = (candidate as Record<string, unknown>)[key];
        return shortcut === null || typeof shortcut === "string";
      }),
    );
  return Boolean(
    appearance &&
    ["light", "dark", "system"].includes(appearance.theme) &&
    typeof appearance.opacity === "number" &&
    ["blue", "teal", "violet", "amber", "rose"].includes(appearance.accent) &&
    typeof settings.alwaysOnTop === "boolean" &&
    validShortcutMap(settings.globalShortcuts, Object.keys(DEFAULT_SETTINGS.globalShortcuts)) &&
    validShortcutMap(settings.appShortcuts, Object.keys(DEFAULT_SETTINGS.appShortcuts)),
  );
}

function loadStoredSnapshot(key: string): Snapshot | null {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (isSnapshot(parsed)) return parsed;
    localStorage.removeItem(key);
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // A locked-down preview may not expose localStorage.
    }
  }
  return null;
}

function loadMock(): Snapshot {
  const saved = loadStoredSnapshot(STORAGE_KEY);
  if (saved) return saved;
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

function persistBackup() {
  try {
    if (lastBackup) localStorage.setItem(BACKUP_KEY, JSON.stringify(lastBackup));
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

export async function takeStartupWarning(): Promise<string | null> {
  if (isTauri) return command<string | null>("take_startup_warning");
  return null;
}

export async function createNote(content: string, sectionId: string | null): Promise<Card> {
  if (isTauri) return command<Card>("create_note", { content, sectionId });
  const stamp = new Date().toISOString();
  const card: Card = {
    id: makeId(),
    content: content.trim(),
    sectionId,
    completed: false,
    sortOrder: Math.max(-1, ...mockState.cards.map((card) => card.sortOrder)) + 1,
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
  const normalizedName = name.trim().replace(/^#\s*/, "").trim();
  if (
    mockState.sections.some(
      (section) => section.name.toLowerCase() === normalizedName.toLowerCase(),
    )
  ) {
    throw new Error("A section with that name already exists.");
  }
  const section: Section = {
    id: makeId(),
    name: normalizedName,
    sortOrder: Math.max(-1, ...mockState.sections.map((item) => item.sortOrder)) + 1,
    createdAt: new Date().toISOString(),
  };
  mockState.sections.push(section);
  persistMock();
  return structuredClone(section);
}

export async function updateCardContent(id: string, content: string): Promise<Card> {
  if (isTauri) return command<Card>("update_card_content", { id, content });
  const card = mockState.cards.find((item) => item.id === id);
  if (!card) throw new Error("That card no longer exists.");
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
  const selected = ids.flatMap((id) => {
    const card = mockState.cards.find((item) => item.id === id);
    return card ? [card] : [];
  });
  if (selected.length < 2) throw new Error("Some selected cards no longer exist.");
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
  const byId = new Map(mockState.cards.map((card) => [card.id, card]));
  const seen = new Set<string>();
  const ordered = ids.flatMap((id) => {
    const card = byId.get(id);
    if (!card || seen.has(id)) return [];
    seen.add(id);
    return [card];
  });
  ordered.push(
    ...mockState.cards
      .filter((card) => !seen.has(card.id))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );
  mockState.cards = ordered.map((card, sortOrder) => ({ ...card, sortOrder }));
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
  persistBackup();
  mockState.cards = [];
  mockState.sections = [];
  persistMock();
  return "browser-backup";
}

export async function restoreBackup(id: string): Promise<Snapshot> {
  if (isTauri) return command<Snapshot>("restore_backup", { id });
  if (!lastBackup) throw new Error("The local backup is no longer available.");
  const current = structuredClone(mockState);
  const sectionIds = new Map<string, string>();
  const sections = current.sections;
  let nextSectionOrder = Math.max(-1, ...sections.map((section) => section.sortOrder)) + 1;
  for (const backedUpSection of lastBackup.sections) {
    const existing = sections.find(
      (section) => section.name.toLowerCase() === backedUpSection.name.toLowerCase(),
    );
    if (existing) {
      sectionIds.set(backedUpSection.id, existing.id);
    } else {
      sections.push({ ...backedUpSection, sortOrder: nextSectionOrder++ });
      sectionIds.set(backedUpSection.id, backedUpSection.id);
    }
  }

  const cards = current.cards;
  const existingCardIds = new Set(cards.map((card) => card.id));
  let nextCardOrder = Math.max(-1, ...cards.map((card) => card.sortOrder)) + 1;
  for (const backedUpCard of lastBackup.cards) {
    if (existingCardIds.has(backedUpCard.id)) continue;
    cards.push({
      ...backedUpCard,
      sectionId: backedUpCard.sectionId ? (sectionIds.get(backedUpCard.sectionId) ?? null) : null,
      sortOrder: nextCardOrder++,
    });
  }
  mockState = { cards, sections, settings: current.settings };
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

export async function rememberPreviousWindow() {
  if (isTauri) return command<void>("remember_previous_window");
}

export async function quitApp() {
  if (isTauri) return command<void>("quit_app");
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
