import { KimiCodeAdapter, readKimiHistoryFromIndependentAcp } from "./kimi-adapter.mjs";

/** OpenCode's stdio ACP transport; no Kimi files or credentials are consulted. */
export class OpenCodeAdapter extends KimiCodeAdapter {
  constructor(options = {}) {
    super({
      ...options,
      provider: "opencode",
      agentName: "OpenCode",
      kimiBin: options.opencodeBin || process.env.OPENCODE_BIN || "opencode",
      kimiArgs: options.opencodeArgs ?? ["acp"],
      sessionStateReader: async () => new Map(),
      agentStateReader: async () => [],
      usageReader: async () => [],
      historyReader: options.historyReader ?? (async (params) => {
        const replay = await readKimiHistoryFromIndependentAcp(params).catch(error => {
          throw new Error(error.message.replaceAll("Kimi Code", "OpenCode").replaceAll("kimi login", "opencode auth login"));
        });
        return { ...replay, agents: [], messages: replay.messages.map(message => ({
          ...message, provider: "opencode",
        })) };
      }),
    });
  }

  async start(handlers) {
    try {
      await super.start(handlers);
    } catch (error) {
      await this.close();
      throw new Error(error.message.replaceAll("Kimi Code", "OpenCode"));
    }
  }

  async requestAuthenticated(method, params, options) {
    try {
      return await this.client.request(method, params, options);
    } catch (error) {
      throw new Error(`OpenCode: ${error.message}`);
    }
  }

  async readUsage() { return {}; }

  async createAgents() {
    throw new Error("OpenCode does not expose a separate remote subagent creation API.");
  }

  toRelaySession(session) {
    const result = super.toRelaySession(session);
    delete result.kimi_config_options;
    delete result.kimi_commands;
    return result;
  }
}
