import type { AppTask, TaskStatus } from "@zihui/contracts";

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["processing", "cancelled", "failed"],
  processing: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}

export function taskIsTerminal(status: TaskStatus): boolean {
  return transitions[status].length === 0;
}

export function taskProgress(status: TaskStatus, progress = 0): number {
  if (status === "queued") return 0;
  if (status === "processing") return Math.max(1, Math.min(99, Math.round(progress)));
  if (status === "succeeded") return 100;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function updateTaskStatus<TRequest, TResult>(
  task: AppTask<TRequest, TResult>,
  status: TaskStatus,
  patch: Partial<Pick<AppTask<TRequest, TResult>, "result" | "error" | "progress">> = {},
): AppTask<TRequest, TResult> {
  assertTaskTransition(task.status, status);
  return {
    ...task,
    ...patch,
    status,
    progress: taskProgress(status, patch.progress ?? task.progress),
    updated_at: new Date().toISOString(),
  };
}

export function normalizeChannel(value: unknown): "desktop" | "web" | "h5" | "mini_program" {
  return value === "desktop" || value === "h5" || value === "mini_program" ? value : "web";
}
