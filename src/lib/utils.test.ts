import { describe, expect, it } from "vitest";
import { copyBlock } from "./utils";

describe("copyBlock", () => {
  it("preserves card order with one clean blank line", () => {
    expect(copyBlock([{ content: " First " }, { content: "Second" }])).toBe("First\n\nSecond");
  });

  it("omits empty cards", () => {
    expect(copyBlock([{ content: "" }, { content: "A captured idea" }])).toBe("A captured idea");
  });

  it("omits whitespace-only cards", () => {
    expect(copyBlock([{ content: "  \n " }, { content: "Kept" }])).toBe("Kept");
  });

  it("returns an empty string for an empty list", () => {
    expect(copyBlock([])).toBe("");
  });
});
