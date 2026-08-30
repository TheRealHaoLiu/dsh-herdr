import type { Context } from "@deepseek-ai/cordis";
import { randomUUID } from "node:crypto";
import type {} from "@deepseek-ai/dsh-agent";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import { LifecycleBridge } from "./lifecycle.js";
import { HerdrReporter, type ProcessRunner } from "./reporter.js";

export {
  LifecycleBridge,
  type DshAgentLike,
  type DshSessionEventLike,
} from "./lifecycle.js";
export {
  SpawnRunner,
  HerdrReporter,
  type HerdrState,
  type ProcessRunner,
} from "./reporter.js";

export interface HerdrPluginConfig {
  /** Stable Herdr report source; use a distinct source for another integration. */
  source?: string;
  /** Label displayed by Herdr for this DSH process. */
  agentLabel?: string;
  /** Test seam; omit in production to use child_process.spawn. */
  runner?: ProcessRunner;
  /** Environment override for focused tests; production defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

const SOURCE = "dsh-herdr";
const LABEL = "dsh";

/** Cordis function-plugin metadata. */
export const name = "dsh-herdr";
export const inject = ["agents"] as const;

/** Avoid Herdr sequence collisions when a pane launches multiple DSH processes. */
export function instanceSource(base: string, instanceId: string): string {
  return `${base}:${instanceId}`;
}

/**
 * Cordis plugin entry point. It is a complete silent no-op unless it runs in a
 * Herdr pane with all three required variables: HERDR_ENV=1, HERDR_PANE_ID,
 * and HERDR_BIN_PATH.
 */
export function apply(ctx: Context, config: HerdrPluginConfig = {}): void {
  const env = config.env ?? process.env;
  const paneId = env.HERDR_PANE_ID;
  const binPath = env.HERDR_BIN_PATH;
  if (env.HERDR_ENV !== "1" || !paneId || !binPath) return;

  const reporter = new HerdrReporter({
    paneId,
    binPath,
    source: instanceSource(config.source ?? SOURCE, randomUUID()),
    agentLabel: config.agentLabel ?? LABEL,
    runner: config.runner,
  });
  const bridge = new LifecycleBridge(reporter, (agent) =>
    ctx.agents.roots().includes(agent as Agent),
  );

  ctx.on("agent/created", ({ agent }) => bridge.agentCreated(agent));
  ctx.on("agent/status", ({ agent, status }) =>
    bridge.agentStatus(agent, status),
  );
  ctx.on("agent/disposed", ({ agent }) => bridge.agentDisposed(agent));
  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    bridge.sessionEvent(String(session.id), event);
  });
  ctx.effect(() => () => bridge.dispose(), "dsh-herdr release");
}
