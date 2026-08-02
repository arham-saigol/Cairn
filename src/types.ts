export type ThemeMode = "light" | "dark" | "system";
export type Accent = "blue" | "teal" | "violet" | "amber" | "rose";

export interface AppearanceSettings {
  theme: ThemeMode;
  opacity: number;
  accent: Accent;
}

export type GlobalShortcutId =
  | "showHide"
  | "captureSelection"
  | "openNewCard"
  | "copyReturn"
  | "copyCompleteReturn"
  | "toggleAlwaysOnTop"
  | "clearAll";

export type AppShortcutId = "mergeSelected" | "editFocused" | "moveToSection";

export interface AppSettings {
  appearance: AppearanceSettings;
  alwaysOnTop: boolean;
  globalShortcuts: Record<GlobalShortcutId, string | null>;
  appShortcuts: Record<AppShortcutId, string | null>;
}

export interface Section {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface Card {
  id: string;
  content: string;
  completed: boolean;
  sectionId: string | null;
  sortOrder: number;
  sourceProcess: string | null;
  sourceWindowTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  cards: Card[];
  sections: Section[];
  settings: AppSettings;
}

export interface GlobalShortcutEvent {
  action: GlobalShortcutId;
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: "system",
    opacity: 94,
    accent: "blue",
  },
  alwaysOnTop: true,
  globalShortcuts: {
    showHide: "Ctrl+Alt+Space",
    captureSelection: "Ctrl+Alt+G",
    openNewCard: "Ctrl+Alt+N",
    copyReturn: "Ctrl+Alt+Enter",
    copyCompleteReturn: "Ctrl+Alt+Shift+Enter",
    toggleAlwaysOnTop: "Ctrl+Alt+P",
    clearAll: null,
  },
  appShortcuts: {
    mergeSelected: "Ctrl+Shift+M",
    editFocused: "F2",
    moveToSection: "Ctrl+Shift+V",
  },
};
