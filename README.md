# dsh-herdr

`dsh-herdr` is a standalone TypeScript plugin that sends a DeepSeek Harness (DSH) root agent's identity and semantic lifecycle to the current [Herdr](https://herdr.dev) pane. It is intentionally best-effort: a missing binary, timeout, non-zero exit, or any other reporting failure is discarded and never reaches DSH.

## Install

Install this package into a DSH profile:

```sh
dsh plugin --profile <name> add dsh-herdr
```

Its bundle layer activates the plugin automatically. The host must already provide the peer dependencies `@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`, and `@deepseek-ai/dsh-session`.

## Compose

Register the plugin on the host/root Cordis context, after the DSH agent registry is available:

```ts
import { apply as herdr } from "dsh-herdr";

await ctx.plugin(herdr);
```

The plugin activates only when all of the following are inherited by the DSH process:

```text
HERDR_ENV=1
HERDR_PANE_ID=<Herdr pane id>
HERDR_BIN_PATH=<absolute path to herdr>
```

Otherwise it registers nothing, starts no process, and produces no logging. This makes ordinary terminals, tests, and headless DSH runs clean no-ops.

`source` and `agentLabel` may be customized when composing if another integration needs a distinct Herdr identity. A unique instance ID is appended to the source automatically so consecutive DSH processes in one pane cannot collide on Herdr sequence numbers:

```ts
await ctx.plugin(herdr, { source: "my-dsh-host", agentLabel: "deepseek" });
```

## Reported lifecycle

The plugin verifies and observes DSH's `agent/created`, `agent/status`, `agent/disposed`, and `session/event` contracts. It maps them to Herdr as follows:

| DSH signal                                              | Herdr state                                              |
| ------------------------------------------------------- | -------------------------------------------------------- |
| root `agent/created`                                    | session identity, then `idle`                            |
| `agent/status: running` or `turn/start`                 | `working`                                                |
| `approval/asked`                                        | `blocked`                                                |
| `approval/decided`, `turn/end`, or `agent/status: idle` | `working` or `idle`, according to the current DSH status |
| root `agent/disposed` or plugin disposal                | release                                                  |

`approval/asked` and `approval/decided` are emitted by DSH's optional `@deepseek-ai/dsh-user-approval` package. Without it, DSH exposes no generic "ask user" lifecycle event, so `blocked` cannot be inferred safely and the plugin continues to report the verified root-agent state.

Commands are issued with `child_process.spawn` and argument arrays—never a shell command. They are serialized in FIFO order, include a strictly increasing `--seq`, and duplicate state values are omitted.

## Shared-pane MVP policy

One `dsh-herdr` instance claims one root DSH agent at a time. It ignores concurrent roots sharing the same pane, as well as all subagents. After the claimed root is disposed, the next root created may claim the pane. This deliberate MVP limitation prevents a concurrent root from overwriting the active root's Herdr agent/session identity or releasing it. Run one active DSH root per pane for complete coverage; concurrent shared-root multiplexing is not yet represented.

## Development

```sh
pnpm install
pnpm run check
pnpm test
pnpm run build
pnpm run format:check
```

The unit tests inject an in-memory process runner; they never invoke a real Herdr binary or server.
