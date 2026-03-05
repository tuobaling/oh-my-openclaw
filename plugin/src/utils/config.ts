import { join } from 'path';
import { PluginConfig, OmocPluginApi, ABSOLUTE_MAX_RALPH_ITERATIONS } from '../types.js';
import { resolveOpenClawWorkspaceDir } from './paths.js';

export function getConfig(api: OmocPluginApi): PluginConfig {
  const wsDir = resolveOpenClawWorkspaceDir();
  const defaults: PluginConfig = {
    max_ralph_iterations: 10,
    todo_enforcer_enabled: false,
    todo_enforcer_cooldown_ms: 2000,
    todo_enforcer_max_failures: 5,
    comment_checker_enabled: true,
    notepad_dir: join(wsDir, 'notepads'),
    plans_dir: join(wsDir, 'plans'),
    checkpoint_dir: join(wsDir, 'checkpoints'),
    tmux_socket: '/tmp/openclaw-tmux-sockets/openclaw.sock',
    model_routing: undefined,
  };

  const config = { ...defaults, ...(api.pluginConfig ?? api.config) };

  // --- Normalization Hotfix Start ---
  // Fix malformed URLs (e.g., "http: //")
  if (config.model_routing) {
    for (const cat in config.model_routing) {
      const entry = config.model_routing[cat];
      if (entry?.model) {
        entry.model = entry.model.replace(/^openai\//, 'openai-codex/');
      }
      if (entry?.alternatives) {
        entry.alternatives = entry.alternatives.map(m => m.replace(/^openai\//, 'openai-codex/'));
      }
    }
  }

  // Deeply normalize any model strings found in the config to use openai-codex
  const normalizeModel = (m: any): any => {
    if (typeof m === 'string') return m.replace(/^openai\//, 'openai-codex/');
    if (m && typeof m === 'object') {
      return {
        ...m,
        primary: m.primary ? normalizeModel(m.primary) : m.primary,
        fallbacks: m.fallbacks ? m.fallbacks.map(normalizeModel) : m.fallbacks,
      };
    }
    return m;
  };

  // Correct URL spaces if present in plugin config (e.g. from broken JSON)
  const root = config as any;
  if (root.plugins?.entries) {
    for (const p in root.plugins.entries) {
      const pConfig = root.plugins.entries[p].config;
      if (pConfig?.embedding?.baseURL) {
        pConfig.embedding.baseURL = pConfig.embedding.baseURL.replace(/: \/\//g, '://');
      }
    }
  }
  if (root.models?.providers) {
    for (const p in root.models.providers) {
      const pProv = root.models.providers[p];
      if (pProv.baseUrl) {
        pProv.baseUrl = pProv.baseUrl.replace(/: \/\//g, '://');
      }
    }
  }

  // Patch agent list in memory
  if (root.agents?.list) {
    for (const agent of root.agents.list) {
      if (agent.model) agent.model = normalizeModel(agent.model);
    }
  }
  if (root.agents?.defaults?.model) {
    root.agents.defaults.model.primary = normalizeModel(root.agents.defaults.model.primary);
    if (root.agents.defaults.model.fallbacks) {
      root.agents.defaults.model.fallbacks = root.agents.defaults.model.fallbacks.map(normalizeModel);
    }
  }
  // --- Normalization Hotfix End ---

  const validation = validateConfig(config);

  if (!validation.valid) {
    api.logger.warn(`Config validation failed: ${validation.errors.join(', ')}`);
  }

  if (config.max_ralph_iterations > ABSOLUTE_MAX_RALPH_ITERATIONS) {
    config.max_ralph_iterations = ABSOLUTE_MAX_RALPH_ITERATIONS;
  }
  if (config.max_ralph_iterations < 0) {
    config.max_ralph_iterations = 0;
  }

  if (config.todo_enforcer_cooldown_ms < 0) {
    config.todo_enforcer_cooldown_ms = 0;
  }
  if (config.todo_enforcer_max_failures < 0) {
    config.todo_enforcer_max_failures = 0;
  }

  return config;
}

export function validateConfig(config: Partial<PluginConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.max_ralph_iterations !== undefined) {
    if (config.max_ralph_iterations < 0 || config.max_ralph_iterations > ABSOLUTE_MAX_RALPH_ITERATIONS) {
      errors.push(`max_ralph_iterations must be between 0 and ${ABSOLUTE_MAX_RALPH_ITERATIONS}`);
    }
  }

  if (config.todo_enforcer_cooldown_ms !== undefined) {
    if (config.todo_enforcer_cooldown_ms < 0) {
      errors.push('todo_enforcer_cooldown_ms must be >= 0 (negative values clamped to 0)');
    }
  }

  if (config.todo_enforcer_max_failures !== undefined) {
    if (config.todo_enforcer_max_failures < 0) {
      errors.push('todo_enforcer_max_failures must be >= 0 (negative values clamped to 0)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
