import { describe, expect, it, vi } from "vitest";

import { resolveDailyMarkdownPath } from "@/lib/server/markdown";

describe("resolveDailyMarkdownPath", () => {
  it("falls back to exports when OBSIDIAN_VAULT_PATH is unset", () => {
    vi.stubEnv("OBSIDIAN_VAULT_PATH", "");

    expect(resolveDailyMarkdownPath("2026-05-13")).toContain("exports");
  });
});
