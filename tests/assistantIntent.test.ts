import { describe, expect, it } from "vitest";

import { classifyAssistantIntent } from "@/lib/server/ai/assistantIntent";

describe("classifyAssistantIntent", () => {
  it.each([
    ["今天先做什么", "plan_today"],
    ["帮我复盘今天", "daily_review"],
    ["这个想法要不要做成任务", "task_gate"],
    ["解释一下 RAG 是什么", "quick_answer"],
    ["帮我拆解这个任务", "task_breakdown"],
    ["我最近学到了什么", "knowledge_recall"],
  ] as const)("%s => %s", (input, intent) => {
    expect(classifyAssistantIntent(input).intent).toBe(intent);
  });
});
