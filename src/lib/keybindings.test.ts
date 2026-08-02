import { describe, expect, it } from "vitest";
import { normalizeShortcut, validateShortcut } from "./keybindings";
import { DEFAULT_SETTINGS } from "../types";

describe("keybinding validation", () => {
  it("normalizes modifiers into a stable order", () => {
    expect(normalizeShortcut("Shift+Control+c")).toBe("Ctrl+Shift+C");
  });

  it("blocks unsafe unmodified global shortcuts", () => {
    expect(validateShortcut("K", "global", "clearAll", DEFAULT_SETTINGS)).toContain(
      "need a modifier",
    );
  });

  it("blocks Windows-reserved shortcuts", () => {
    expect(validateShortcut("Alt+F4", "global", "clearAll", DEFAULT_SETTINGS)).toContain("closing");
  });

  it("detects duplicates", () => {
    expect(validateShortcut("Ctrl+Alt+G", "global", "clearAll", DEFAULT_SETTINGS)).toContain(
      "already assigned",
    );
  });

  it("allows practical modifier double-taps", () => {
    expect(validateShortcut("DoubleTap:Shift", "global", "clearAll", DEFAULT_SETTINGS)).toBeNull();
  });
});
