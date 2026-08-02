import type { AppSettings, AppShortcutId, GlobalShortcutId } from "../types";

export interface ShortcutDescription<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const GLOBAL_SHORTCUTS: ShortcutDescription<GlobalShortcutId>[] = [
  {
    id: "showHide",
    label: "Show or hide Cairn",
    description: "Reveal the rail beside the app you are working in.",
  },
  {
    id: "captureSelection",
    label: "Capture selected text",
    description: "Read the current selection and add it as a card.",
  },
  {
    id: "openNewCard",
    label: "Add a new card",
    description: "Open Cairn with the composer focused.",
  },
  {
    id: "copyReturn",
    label: "Copy and return",
    description: "Copy selected cards, then focus the previous app.",
  },
  {
    id: "copyCompleteReturn",
    label: "Copy, complete, and return",
    description: "Complete cards only after the copy succeeds.",
  },
  {
    id: "toggleAlwaysOnTop",
    label: "Toggle always on top",
    description: "Pin or unpin the floating rail.",
  },
  {
    id: "clearAll",
    label: "Clear all content",
    description: "Opens the same confirmation dialog as the menu action.",
  },
];

export const APP_SHORTCUTS: ShortcutDescription<AppShortcutId>[] = [
  {
    id: "mergeSelected",
    label: "Merge selected cards",
    description: "Combine selected cards in their current order.",
  },
  {
    id: "editFocused",
    label: "Edit focused card",
    description: "Place the focused card into inline editing mode.",
  },
  {
    id: "moveToSection",
    label: "Move to section",
    description: "Open the section picker for selected cards.",
  },
];

export const FIXED_SHORTCUTS = [
  ["Ctrl+C", "Copy selected cards"],
  ["Ctrl+Shift+C", "Copy and complete selected cards"],
  ["Ctrl+A", "Select all visible cards"],
  ["Ctrl+K", "Focus search / section switcher"],
  ["Ctrl+N", "Focus new-card input"],
  ["Enter", "Open or confirm"],
  ["Space", "Toggle completion"],
  ["Delete", "Confirm deletion"],
  ["Escape", "Cancel, clear, close, or hide"],
  ["Arrow keys", "Move focus"],
  ["Shift+Arrow", "Extend selection"],
] as const;

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Win"];
const MODIFIER_KEYS = new Map([
  ["Control", "Ctrl"],
  ["Ctrl", "Ctrl"],
  ["Alt", "Alt"],
  ["Shift", "Shift"],
  ["Meta", "Win"],
  ["Win", "Win"],
]);

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  Escape: "Escape",
  Esc: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Del: "Delete",
  ".": ".",
  ",": ",",
};

export function normalizeKeyName(key: string) {
  if (MODIFIER_KEYS.has(key)) return MODIFIER_KEYS.get(key)!;
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (key.length === 1) return key.toUpperCase();
  return key[0]?.toUpperCase() + key.slice(1);
}

export function normalizeShortcut(shortcut: string) {
  if (shortcut.startsWith("DoubleTap:")) {
    return `DoubleTap:${normalizeKeyName(shortcut.slice(10))}`;
  }
  const parts = shortcut.split("+").map(normalizeKeyName);
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier));
  const key = parts.find((part) => !MODIFIER_ORDER.includes(part));
  return [...modifiers, ...(key ? [key] : [])].join("+");
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  const key = normalizeKeyName(event.key);
  if (MODIFIER_ORDER.includes(key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Win");
  parts.push(key);
  return normalizeShortcut(parts.join("+"));
}

const RESERVED = new Map([
  ["Alt+F4", "Windows reserves this for closing the active window."],
  ["Alt+Tab", "Windows reserves this for switching applications."],
  ["Ctrl+Alt+Delete", "Windows reserves this security shortcut."],
  ["Ctrl+Shift+Escape", "Windows reserves this for Task Manager."],
  ["Win+D", "Windows reserves this for showing the desktop."],
  ["Win+E", "Windows reserves this for File Explorer."],
  ["Win+L", "Windows reserves this for locking the computer."],
  ["Win+R", "Windows reserves this for Run."],
  ["Win+Tab", "Windows reserves this for Task View."],
]);

const FIXED_VALUES = new Set(
  FIXED_SHORTCUTS.map(([shortcut]) => normalizeShortcut(shortcut)).filter(
    (shortcut) => !shortcut.includes("keys") && !shortcut.includes("Arrow"),
  ),
);

export function validateShortcut(
  value: string,
  scope: "global" | "app",
  currentId: string,
  settings: AppSettings,
) {
  const normalized = normalizeShortcut(value);
  if (!normalized) return "Press a key or key combination.";
  if (RESERVED.has(normalized)) return RESERVED.get(normalized)!;

  if (normalized.startsWith("DoubleTap:")) {
    const modifier = normalized.slice(10);
    if (scope !== "global") return "Modifier double-taps are available for global shortcuts only.";
    if (!new Set(["Ctrl", "Alt", "Shift"]).has(modifier)) {
      return "Only Ctrl, Alt, and Shift can be used as double-tap shortcuts.";
    }
  } else {
    const parts = normalized.split("+");
    const modifiers = parts.filter((part) => MODIFIER_ORDER.includes(part));
    const key = parts.find((part) => !MODIFIER_ORDER.includes(part));
    if (!key) return "Add a non-modifier key, or double-tap a modifier.";
    if (scope === "global" && modifiers.length === 0 && !/^F([1-9]|1\d|2[0-4])$/.test(key)) {
      return "Global shortcuts need a modifier so normal typing stays safe.";
    }
    if (scope === "app" && FIXED_VALUES.has(normalized)) {
      return "That shortcut is reserved for standard Cairn editing behavior.";
    }
  }

  const entries = [
    ...Object.entries(settings.globalShortcuts).map(([id, shortcut]) => ({
      id,
      scope: "global",
      shortcut,
    })),
    ...Object.entries(settings.appShortcuts).map(([id, shortcut]) => ({
      id,
      scope: "app",
      shortcut,
    })),
  ];
  const duplicate = entries.find(
    (entry) =>
      entry.shortcut &&
      !(entry.id === currentId && entry.scope === scope) &&
      normalizeShortcut(entry.shortcut) === normalized,
  );
  if (duplicate) return "That shortcut is already assigned to another Cairn command.";
  return null;
}

export function shortcutMatches(event: KeyboardEvent, value: string | null) {
  return Boolean(value && shortcutFromKeyboardEvent(event) === normalizeShortcut(value));
}

export function shortcutTokens(shortcut: string | null) {
  if (!shortcut) return ["Not set"];
  if (shortcut.startsWith("DoubleTap:")) return [shortcut.slice(10), shortcut.slice(10)];
  return shortcut.split("+");
}
