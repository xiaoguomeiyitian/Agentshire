/**
 * Centralized state directory resolution for OpenClaw / QClaw compatibility.
 *
 * Called once during plugin registration via initStateDir(runtime.config).
 * All plugin modules import stateDir() to build platform-aware paths.
 */

import { dirname, join } from "node:path";
import { homedir } from "node:os";

let _stateDir: string;

export function initStateDir(runtimeConfig: any): void {
  let cfg: any = runtimeConfig;
  if (typeof cfg?.current === "function") {
    try { cfg = cfg.current(); } catch {}
  } else if (typeof cfg?.loadConfig === "function") {
    try { cfg = cfg.loadConfig(); } catch {}
  }
  const workspace: string | undefined = cfg?.agents?.defaults?.workspace;
  if (workspace) {
    const expanded = workspace.startsWith("~/")
      ? join(homedir(), workspace.slice(2))
      : workspace;
    _stateDir = dirname(expanded);
  } else {
    _stateDir = join(homedir(), ".openclaw");
  }
  console.log(`[agentshire] State directory: ${_stateDir}`);
}

export function stateDir(): string {
  if (!_stateDir) throw new Error("paths not initialized — call initStateDir() first");
  return _stateDir;
}
