import { spawn } from "node:child_process";

export type HerdrState = "idle" | "working" | "blocked";

export interface ProcessRunner {
  run(file: string, args: readonly string[]): Promise<void>;
}

export interface HerdrReporterOptions {
  paneId: string;
  binPath: string;
  source: string;
  agentLabel: string;
  runner?: ProcessRunner;
}

/** A bounded spawn adapter. Its result is deliberately ignored by callers. */
export class SpawnRunner implements ProcessRunner {
  constructor(private readonly timeoutMs = 2_000) {}

  run(file: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve) => {
      try {
        const child = spawn(file, [...args], {
          windowsHide: true,
          // The plugin never needs output and must not inherit DSH's terminal.
          stdio: "ignore",
        });
        const timeout = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
        timeout.unref();
        const finish = () => {
          clearTimeout(timeout);
          resolve();
        };
        child.once("error", finish);
        child.once("close", finish);
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Serializes Herdr commands without ever exposing a promise to DSH event
 * handlers. Sequence values advance at enqueue time, including failed sends.
 */
export class HerdrReporter {
  private readonly runner: ProcessRunner;
  private pending: Promise<void> = Promise.resolve();
  private sequence = 0;
  private sessionId: string | undefined;
  private state: HerdrState | undefined;
  private stopped = false;

  constructor(private readonly options: HerdrReporterOptions) {
    this.runner = options.runner ?? new SpawnRunner();
  }

  bind(sessionId: string): void {
    if (this.stopped || this.sessionId === sessionId) return;
    this.sessionId = sessionId;
    this.enqueue([
      "pane",
      "report-agent-session",
      this.options.paneId,
      "--source",
      this.options.source,
      "--agent",
      this.options.agentLabel,
      "--agent-session-id",
      sessionId,
    ]);
  }

  report(state: HerdrState): void {
    if (this.stopped || this.sessionId === undefined || this.state === state)
      return;
    this.state = state;
    this.enqueue([
      "pane",
      "report-agent",
      this.options.paneId,
      "--source",
      this.options.source,
      "--agent",
      this.options.agentLabel,
      "--state",
      state,
      "--agent-session-id",
      this.sessionId,
    ]);
  }

  release(): void {
    if (this.stopped || this.sessionId === undefined) return;
    this.enqueue([
      "pane",
      "release-agent",
      this.options.paneId,
      "--source",
      this.options.source,
      "--agent",
      this.options.agentLabel,
    ]);
    this.sessionId = undefined;
    this.state = undefined;
  }

  /** Release the current identity and permanently reject later lifecycle work. */
  stop(): void {
    if (this.stopped) return;
    this.release();
    this.stopped = true;
  }

  /** Test-only observation point; production callers must not await telemetry. */
  drain(): Promise<void> {
    return this.pending;
  }

  private enqueue(command: string[]): void {
    const args = [...command, "--seq", String(++this.sequence)];
    this.pending = this.pending
      .then(() => this.runner.run(this.options.binPath, args))
      .catch(() => undefined);
  }
}
