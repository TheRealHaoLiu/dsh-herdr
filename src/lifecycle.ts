import type { HerdrReporter, HerdrState } from "./reporter.js";

export interface DshAgentLike {
  readonly id: string;
  readonly status: "idle" | "running";
}

export interface DshSessionEventLike {
  readonly type: string;
  readonly data?: unknown;
}

function approvalId(event: DshSessionEventLike): unknown {
  if (typeof event.data !== "object" || event.data === null) return undefined;
  return "id" in event.data ? event.data.id : undefined;
}

/**
 * Converts verified DSH lifecycle events to Herdr's semantic states.
 *
 * One plugin instance deliberately owns at most one root DSH agent. This is a
 * safe MVP policy for a shared terminal pane: subsequent roots are ignored
 * instead of overwriting the first root's Herdr identity or state.
 */
export class LifecycleBridge {
  private owner: DshAgentLike | undefined;
  private readonly pendingApprovals = new Set<unknown>();

  constructor(
    private readonly reporter: HerdrReporter,
    private readonly isRoot: (agent: DshAgentLike) => boolean,
  ) {}

  agentCreated(agent: DshAgentLike): void {
    if (this.owner !== undefined || !this.isRoot(agent)) return;
    this.owner = agent;
    this.reporter.bind(agent.id);
    this.reporter.report("idle");
  }

  agentStatus(agent: DshAgentLike, status: "idle" | "running"): void {
    if (agent !== this.owner) return;
    this.reporter.report(
      this.pendingApprovals.size > 0
        ? "blocked"
        : status === "running"
          ? "working"
          : "idle",
    );
  }

  sessionEvent(sessionId: string, event: DshSessionEventLike): void {
    if (this.owner?.id !== sessionId) return;
    switch (event.type) {
      case "turn/start":
        this.reporter.report("working");
        break;
      case "approval/asked":
        this.pendingApprovals.add(approvalId(event));
        this.reporter.report("blocked");
        break;
      case "approval/decided":
        this.pendingApprovals.delete(approvalId(event));
        this.reporter.report(
          this.pendingApprovals.size > 0
            ? "blocked"
            : this.owner.status === "running"
              ? "working"
              : "idle",
        );
        break;
      case "turn/end":
        this.pendingApprovals.clear();
        this.reporter.report(
          this.owner.status === "running" ? "working" : "idle",
        );
        break;
    }
  }

  agentDisposed(agent: DshAgentLike): void {
    if (agent !== this.owner) return;
    this.reporter.release();
    this.pendingApprovals.clear();
    this.owner = undefined;
  }

  dispose(): void {
    this.reporter.stop();
    this.pendingApprovals.clear();
    this.owner = undefined;
  }

  currentState(): HerdrState | undefined {
    if (this.owner === undefined) return undefined;
    return this.pendingApprovals.size > 0
      ? "blocked"
      : this.owner.status === "running"
        ? "working"
        : "idle";
  }
}
