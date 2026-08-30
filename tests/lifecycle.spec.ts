import { describe, expect, it } from "vitest";
import { LifecycleBridge, type DshAgentLike } from "../src/lifecycle.js";
import { HerdrReporter, type ProcessRunner } from "../src/reporter.js";

class RecordingRunner implements ProcessRunner {
  readonly calls: string[][] = [];
  async run(_file: string, args: readonly string[]): Promise<void> {
    this.calls.push([...args]);
  }
}

function setup() {
  const runner = new RecordingRunner();
  const reporter = new HerdrReporter({
    paneId: "p",
    binPath: "herdr",
    source: "dsh-herdr",
    agentLabel: "dsh",
    runner,
  });
  const roots = new Set<DshAgentLike>();
  return {
    runner,
    reporter,
    roots,
    bridge: new LifecycleBridge(reporter, (agent) => roots.has(agent)),
  };
}

describe("LifecycleBridge", () => {
  it("reports identity and semantic lifecycle states for its root agent", async () => {
    const { runner, reporter, roots, bridge } = setup();
    const agent: DshAgentLike = { id: "session-1", status: "idle" };
    roots.add(agent);
    bridge.agentCreated(agent);
    bridge.agentStatus(agent, "running");
    bridge.sessionEvent("session-1", {
      type: "approval/asked",
      data: { id: "approval-1" },
    });
    bridge.sessionEvent("session-1", {
      type: "approval/decided",
      data: { id: "approval-1" },
    });
    bridge.agentStatus(agent, "idle");
    bridge.agentDisposed(agent);
    await reporter.drain();
    expect(
      runner.calls
        .filter((call) => call.includes("--state"))
        .map((call) => call[call.indexOf("--state") + 1]),
    ).toEqual(["idle", "working", "blocked", "idle"]);
    expect(runner.calls.at(-1)).toContain("release-agent");
  });

  it("stays blocked until every concurrent approval is decided", async () => {
    const { runner, reporter, roots, bridge } = setup();
    const agent: DshAgentLike = { id: "session-1", status: "running" };
    roots.add(agent);
    bridge.agentCreated(agent);
    bridge.sessionEvent("session-1", {
      type: "approval/asked",
      data: { id: "first" },
    });
    bridge.sessionEvent("session-1", {
      type: "approval/asked",
      data: { id: "second" },
    });
    bridge.sessionEvent("session-1", {
      type: "approval/decided",
      data: { id: "first" },
    });
    expect(bridge.currentState()).toBe("blocked");
    bridge.sessionEvent("session-1", {
      type: "approval/decided",
      data: { id: "second" },
    });
    expect(bridge.currentState()).toBe("working");
    await reporter.drain();
    expect(
      runner.calls
        .filter((call) => call.includes("--state"))
        .map((call) => call[call.indexOf("--state") + 1]),
    ).toEqual(["idle", "blocked", "working"]);
  });

  it("safely ignores a second root sharing the pane", async () => {
    const { runner, reporter, roots, bridge } = setup();
    const first: DshAgentLike = { id: "first", status: "idle" };
    const second: DshAgentLike = { id: "second", status: "running" };
    roots.add(first);
    roots.add(second);
    bridge.agentCreated(first);
    bridge.agentCreated(second);
    bridge.agentStatus(second, "running");
    bridge.agentDisposed(second);
    await reporter.drain();
    expect(runner.calls.flat()).not.toContain("second");
    expect(runner.calls.flat()).not.toContain("release-agent");
  });

  it("claims a later root after the prior root is disposed", async () => {
    const { runner, reporter, roots, bridge } = setup();
    const first: DshAgentLike = { id: "first", status: "idle" };
    const second: DshAgentLike = { id: "second", status: "idle" };
    roots.add(first);
    roots.add(second);
    bridge.agentCreated(first);
    bridge.agentDisposed(first);
    bridge.agentCreated(second);
    await reporter.drain();
    expect(runner.calls.flat().filter((arg) => arg === "first")).toHaveLength(
      2,
    );
    expect(runner.calls.flat().filter((arg) => arg === "second")).toHaveLength(
      2,
    );
    expect(
      runner.calls.filter((call) => call.includes("report-agent-session")),
    ).toHaveLength(2);
  });

  it("rejects later roots after plugin disposal", async () => {
    const { runner, reporter, roots, bridge } = setup();
    const first: DshAgentLike = { id: "first", status: "idle" };
    const second: DshAgentLike = { id: "second", status: "idle" };
    roots.add(first);
    roots.add(second);
    bridge.agentCreated(first);
    bridge.dispose();
    bridge.agentCreated(second);
    await reporter.drain();
    expect(runner.calls.flat()).not.toContain("second");
    expect(
      runner.calls.filter((call) => call.includes("release-agent")),
    ).toHaveLength(1);
  });
});
