import { describe, expect, it } from "vitest";
import { formatNaira } from "../src/i18n/numbers.ts";

describe("scaffold", () => {
  it("formats naira", () => {
    expect(formatNaira(118_000, "en")).toBe("₦118,000");
  });
});
