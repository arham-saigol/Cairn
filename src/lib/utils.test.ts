import { describe, expect, it } from "vitest";
import { copyBlock } from "./utils";

describe("copyBlock", () => {
  it("preserves card order with one clean blank line", () => {
    expect(copyBlock([{ content: " First " }, { content: "Second" }])).toBe("First\n\nSecond");
  });

  it("omits empty cards and has no UI metadata", () => {
    expect(copyBlock([{ content: "" }, { content: "A captured idea" }])).toBe("A captured idea");
  });
});
