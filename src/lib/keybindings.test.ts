import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SHORTCUT_MESSAGE,
  normalizeShortcut,
  UNSAFE_GLOBAL_SHORTCUT_MESSAGE,
  validateShortcut,
  WINDOWS_RESERVED_SHORTCUT_MESSAGE,
} from "./keybindings";
import { DEFAULT_SETTINGS } from "../types";

describe("keybinding validation", () => {
  it("normalizes modifiers into a stable order", () => {
    expect(normalizeShortcut("Shift+Control+c")).toBe("Ctrl+Shift+C");
  });

  it("blocks unsafe unmodified global shortcuts", () => {
    expect(validateShortcut("K", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      UNSAFE_GLOBAL_SHORTCUT_MESSAGE,
    );
  });

  it("blocks Windows-reserved shortcuts", () => {
    expect(validateShortcut("Alt+F4", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      WINDOWS_RESERVED_SHORTCUT_MESSAGE,
    );
  });

  it("detects duplicates", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.globalShortcuts.showHide = "Ctrl+Alt+G";
    expect(validateShortcut("Ctrl+Alt+G", "global", "clearAll", settings)).toBe(
      DUPLICATE_SHORTCUT_MESSAGE,
    );
  });

  it("allows practical modifier double-taps", () => {
    expect(validateShortcut("DoubleTap:Shift", "global", "clearAll", DEFAULT_SETTINGS)).toBeNull();
  });

  it("covers global function-key boundaries", () => {
    expect(validateShortcut("F24", "global", "clearAll", DEFAULT_SETTINGS)).toBeNull();
    expect(validateShortcut("F25", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      UNSAFE_GLOBAL_SHORTCUT_MESSAGE,
    );
  });

  it("rejects invalid double-taps", () => {
    expect(validateShortcut("DoubleTap:Shift", "app", "editFocused", DEFAULT_SETTINGS)).toBe(
      "Modifier double-taps are available for global shortcuts only.",
    );
    expect(validateShortcut("DoubleTap:Win", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      "Only Ctrl, Alt, and Shift can be used as double-tap shortcuts.",
    );
  });

  it("rejects modifier-only and empty shortcuts", () => {
    expect(validateShortcut("Ctrl+Shift", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      "Add a non-modifier key, or double-tap a modifier.",
    );
    expect(validateShortcut("", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      "Press a key or key combination.",
    );
  });

  it("rejects global keys unsupported by the native registrar", () => {
    expect(validateShortcut("Ctrl+Alt+Home", "global", "clearAll", DEFAULT_SETTINGS)).toBe(
      "Home is not supported as a global shortcut key.",
    );
  });
});
