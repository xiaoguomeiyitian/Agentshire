import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setTownRuntime, getRuntime: getTownRuntime } =
  createPluginRuntimeStore<PluginRuntime>(
    "Agentshire runtime not initialized — plugin not registered",
  );

export { setTownRuntime, getTownRuntime };
