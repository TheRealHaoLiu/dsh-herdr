import { describe, expect, it } from "vitest";
import { HerdrReporter, type ProcessRunner } from "../src/reporter.js";

class RecordingRunner implements ProcessRunner {
  readonly calls: Array<{ file: string; args: readonly string[] }> = [];
  fail = false;

  async run(file: string, args: readonly string[]): Promise<void> {
    this.calls.push({ file, args });
    if (this.fail) throw new Error("Herdr unavailable");
  }
}

describe("HerdrReporter", () => {
  it("uses ordered argument arrays, deduplicates states, and sequences every command", async () => {
    const runner = new RecordingRunner();
    const reporter = new HerdrReporter({
      paneId: "w1:p1",
      binPath: "/bin/herdr",
      source: "dsh-herdr",
      agentLabel: "dsh",
      runner,
    });
    reporter.bind("session-1");
    reporter.report("idle");
    reporter.report("idle");
    reporter.report("working");
    reporter.release();
    await reporter.drain();

    expect(runner.calls).toEqual([
      {
        file: "/bin/herdr",
        args: [
          "pane",
          "report-agent-session",
          "w1:p1",
          "--source",
          "dsh-herdr",
          "--agent",
          "dsh",
          "--agent-session-id",
          "session-1",
          "--seq",
          "1",
        ],
      },
      {
        file: "/bin/herdr",
        args: [
          "pane",
          "report-agent",
          "w1:p1",
          "--source",
          "dsh-herdr",
          "--agent",
          "dsh",
          "--state",
          "idle",
          "--agent-session-id",
          "session-1",
          "--seq",
          "2",
        ],
      },
      {
        file: "/bin/herdr",
        args: [
          "pane",
          "report-agent",
          "w1:p1",
          "--source",
          "dsh-herdr",
          "--agent",
          "dsh",
          "--state",
          "working",
          "--agent-session-id",
          "session-1",
          "--seq",
          "3",
        ],
      },
      {
        file: "/bin/herdr",
        args: [
          "pane",
          "release-agent",
          "w1:p1",
          "--source",
          "dsh-herdr",
          "--agent",
          "dsh",
          "--seq",
          "4",
        ],
      },
    ]);
  });

  it("contains runner failures and continues its queue", async () => {
    const runner = new RecordingRunner();
    const reporter = new HerdrReporter({
      paneId: "p",
      binPath: "herdr",
      source: "source",
      agentLabel: "label",
      runner,
    });
    runner.fail = true;
    reporter.bind("s");
    reporter.report("idle");
    await expect(reporter.drain()).resolves.toBeUndefined();
    expect(runner.calls).toHaveLength(2);
  });

  it("releases once and rejects later work after stop", async () => {
    const runner = new RecordingRunner();
    const reporter = new HerdrReporter({
      paneId: "p",
      binPath: "herdr",
      source: "source",
      agentLabel: "label",
      runner,
    });
    reporter.bind("first");
    reporter.report("working");
    reporter.stop();
    reporter.stop();
    reporter.bind("second");
    reporter.report("idle");
    await reporter.drain();
    expect(
      runner.calls.filter(({ args }) => args.includes("release-agent")),
    ).toHaveLength(1);
    expect(runner.calls.flatMap(({ args }) => args)).not.toContain("second");
  });
});
