import { Scheduler } from "../../src/sessionManager";

interface ScheduledTask {
  id: number;
  runAt: number;
  callback: () => void;
  cleared: boolean;
}

export class FakeScheduler implements Scheduler {
  private nowMs = 0;
  private nextId = 1;
  private readonly tasks: ScheduledTask[] = [];

  public now(): number {
    return this.nowMs;
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const task: ScheduledTask = {
      id: this.nextId,
      runAt: this.nowMs + Math.max(0, delayMs),
      callback,
      cleared: false
    };

    this.nextId += 1;
    this.tasks.push(task);
    return task.id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle !== "number") {
      return;
    }

    const task = this.tasks.find((item) => item.id === handle);
    if (task) {
      task.cleared = true;
    }
  }

  public advanceBy(ms: number): void {
    const target = this.nowMs + Math.max(0, ms);

    while (true) {
      const nextTask = this.getNextRunnableTask(target);
      if (!nextTask) {
        break;
      }

      this.nowMs = nextTask.runAt;
      nextTask.cleared = true;
      nextTask.callback();
    }

    this.nowMs = target;
  }

  private getNextRunnableTask(target: number): ScheduledTask | undefined {
    let candidate: ScheduledTask | undefined;

    for (const task of this.tasks) {
      if (task.cleared || task.runAt > target) {
        continue;
      }

      if (!candidate || task.runAt < candidate.runAt || (task.runAt === candidate.runAt && task.id < candidate.id)) {
        candidate = task;
      }
    }

    return candidate;
  }
}