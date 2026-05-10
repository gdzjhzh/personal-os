import type { Task } from "@/lib/types";

export function generateCodexPacket(task: Task) {
  const riskFlags =
    task.riskFlags.length > 0 ? task.riskFlags.join(", ") : "无";
  const doNot = [
    ...task.doNot,
    "Do not expand scope.",
    "Do not implement future roadmap items.",
    "Do not replace the local JSON store.",
  ];

  return `# Codex Task: ${task.code} - ${task.title}

## Goal
${task.title}

## Context
This project is Personal SaaS OS, a local-first personal execution system for daily planning, active task tracking, Codex task delegation, review, and Obsidian markdown export.

Current phase: build the simplest local V0 and use it daily.

## Current Task
- priority: ${task.priority}
- project: ${task.project}
- status: ${task.status}
- codexFit: ${task.codexFit}
- nextAction: ${task.nextAction || "未填写"}
- doneWhen: ${task.doneWhen || "未填写"}
- riskFlags: ${riskFlags}

## Scope
Only implement what is required for this task.

## Constraints
- Keep changes small.
- Do not introduce database.
- Do not introduce Docker.
- Do not add authentication.
- Do not build unrelated features.
- Do not over-optimize UI.
- Prefer simple working code.

## Done When
${task.doneWhen || "按本任务的完成标准验收。"}

## Do Not
${doNot.map((item) => `- ${item}`).join("\n")}

## Review Checklist
- Does it run locally?
- Does it satisfy Done When?
- Did it avoid unrelated changes?
- Did it keep the implementation simple?
- What files changed?
`;
}
