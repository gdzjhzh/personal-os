import type { Task } from "@/lib/types";

export type P0Decision = {
  task: Task | null;
  score: number;
  reasons: string[];
};

export const DO_NOT_DO_LIST = [
  "不研究复杂 Agent 框架",
  "不做 RAG",
  "不做自动爬虫",
  "不做完整项目管理系统",
  "不优化 UI 细节",
  "不做和当前 P0 无关的泛学习",
];

export function isConcreteAction(value: string) {
  const text = value.trim();

  if (text.length < 8) {
    return false;
  }

  const vagueTerms = ["学习", "研究一下", "看看", "了解", "优化", "思考"];
  const hasVagueTerm = vagueTerms.some((term) => text.includes(term));
  const hasConcreteSignal =
    /实现|写|完成|创建|导出|记录|修复|打开|提交|生成|整理|拆解|验证|运行/.test(
      text,
    );

  return hasConcreteSignal || !hasVagueTerm;
}

export function chooseTodayP0(tasks: Task[]): P0Decision {
  const candidates = tasks.filter((task) =>
    ["active", "codex_ready"].includes(task.status),
  );

  if (candidates.length === 0) {
    return {
      task: null,
      score: 0,
      reasons: ["当前没有 active 或 codex_ready 任务。"],
    };
  }

  const scored = candidates.map((task) => {
    const reasons: string[] = [];
    let score = 0;

    if (task.priority === "P0") {
      score += 100;
      reasons.push("优先级是 P0");
    } else if (task.priority === "P1") {
      score += 50;
      reasons.push("优先级是 P1");
    } else {
      score += 20;
      reasons.push("优先级是 P2");
    }

    if (task.status === "active") {
      score += 30;
      reasons.push("状态 active，可立即推进");
    }

    if (task.status === "codex_ready") {
      score += 28;
      reasons.push("状态 codex_ready，可交给 Codex");
    }

    const concrete = isConcreteAction(task.nextAction);

    if (concrete) {
      score += 25;
      reasons.push("nextAction 足够具体");
    } else if (task.nextAction.trim()) {
      score += 8;
      reasons.push("nextAction 已填写但仍偏泛");
    }

    if (task.doneWhen.trim()) {
      score += 20;
      reasons.push("doneWhen 明确");
    }

    for (const risk of task.riskFlags) {
      if (risk === "泛学习") {
        score -= 18;
        reasons.push("风险含泛学习，扣分");
      }
      if (risk === "信息刷屏") {
        score -= 18;
        reasons.push("风险含信息刷屏，扣分");
      }
      if (risk === "任务过大") {
        if (concrete) {
          score -= 5;
          reasons.push("任务过大但 nextAction 具体，仅轻微扣分");
        } else {
          score -= 20;
          reasons.push("任务过大且动作不够具体，扣分");
        }
      }
    }

    return { task, score, reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.task.code.localeCompare(b.task.code);
  });

  return scored[0];
}

export function minimumActionFromP0(task: Task | null) {
  if (task?.nextAction.trim()) {
    return `用 25 分钟完成：${task.nextAction.trim()}`;
  }

  return "用 25 分钟整理一个当前最重要任务，并写出 nextAction 和 doneWhen。";
}

export function scheduleAdvice(decision: P0Decision) {
  if (!decision.task) {
    return "先不要扩展系统。用 25 分钟补齐一个最重要任务的 nextAction 和 doneWhen，然后再决定是否交给 Codex。";
  }

  const task = decision.task;

  if (task.codexFit === "high" && task.status === "codex_ready") {
    return `优先把 ${task.code} 交给 Codex 执行，人工只负责验收 Done When。`;
  }

  if (task.codexFit === "high" || task.owner === "mixed") {
    return `先人工完成 ${task.code} 的 25 分钟最小动作，再把明确边界后的实现交给 Codex。`;
  }

  return `先手动推进 ${task.code}，避免把不清晰的判断任务过早交给 Codex。`;
}
