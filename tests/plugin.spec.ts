import { describe, expect, it } from "vitest";
import {
  apply,
  inject,
  instanceSource,
  name,
  type HerdrPluginConfig,
} from "../src/index.js";

type Listener = (...args: never[]) => void;

function context() {
  const listeners = new Map<string, Listener>();
  return {
    agents: { roots: () => [] },
    on: (name: string, listener: Listener) => {
      listeners.set(name, listener);
    },
    effect: () => undefined,
    listeners,
  };
}

describe("apply", () => {
  it("declares the Cordis agent-service dependency", () => {
    expect(name).toBe("dsh-herdr");
    expect(inject).toEqual(["agents"]);
  });

  it("scopes report sources to one plugin instance", () => {
    expect(instanceSource("dsh-herdr", "instance-1234")).toBe(
      "dsh-herdr:instance-1234",
    );
  });

  it.each<HerdrPluginConfig["env"]>([
    {},
    { HERDR_ENV: "0", HERDR_PANE_ID: "p", HERDR_BIN_PATH: "herdr" },
    { HERDR_ENV: "1", HERDR_BIN_PATH: "herdr" },
    { HERDR_ENV: "1", HERDR_PANE_ID: "p" },
  ])("is a silent no-op without the complete Herdr environment", (env) => {
    const ctx = context();
    expect(() => apply(ctx as never, { env })).not.toThrow();
    expect(ctx.listeners).toHaveLength(0);
  });
});
