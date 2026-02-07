/**
 * Executor profiles and configuration
 * Translates: crates/executors/src/profile.rs
 */

import type {
  BaseCodingAgent,
  CodingAgent,
  AvailabilityInfo,
} from './executors/index.js';

// --- canonicalVariantKey ---

export function canonicalVariantKey(raw: string): string {
  if (raw.toUpperCase() === 'DEFAULT') {
    return 'DEFAULT';
  }
  // Convert to SCREAMING_SNAKE_CASE
  return raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

// --- ProfileError ---

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }

  static cannotDeleteExecutor(executor: BaseCodingAgent): ProfileError {
    return new ProfileError(`Built-in executor '${executor}' cannot be deleted`);
  }

  static cannotDeleteBuiltInConfig(executor: BaseCodingAgent, variant: string): ProfileError {
    return new ProfileError(`Built-in configuration '${executor}:${variant}' cannot be deleted`);
  }

  static validation(msg: string): ProfileError {
    return new ProfileError(`Validation error: ${msg}`);
  }

  static noAvailableExecutorProfile(): ProfileError {
    return new ProfileError('No available executor profile');
  }
}

// --- ExecutorProfileId ---

export interface ExecutorProfileId {
  executor: BaseCodingAgent;
  variant?: string;
}

export function createExecutorProfileId(executor: BaseCodingAgent, variant?: string): ExecutorProfileId {
  return { executor, variant };
}

export function executorProfileIdCacheKey(id: ExecutorProfileId): string {
  if (id.variant) {
    return `${id.executor}:${id.variant}`;
  }
  return id.executor;
}

export function executorProfileIdToString(id: ExecutorProfileId): string {
  return executorProfileIdCacheKey(id);
}

export function toDefaultVariant(id: ExecutorProfileId): ExecutorProfileId {
  return { executor: id.executor, variant: undefined };
}

// --- ExecutorConfig ---

export interface ExecutorConfig {
  configurations: Record<string, CodingAgent>;
}

export function getVariant(config: ExecutorConfig, variant: string): CodingAgent | undefined {
  return config.configurations[variant];
}

export function getDefault(config: ExecutorConfig): CodingAgent | undefined {
  return config.configurations['DEFAULT'];
}

export function newWithDefault(defaultConfig: CodingAgent): ExecutorConfig {
  return {
    configurations: { DEFAULT: defaultConfig },
  };
}

export function setVariant(config: ExecutorConfig, variantName: string, codingAgent: CodingAgent): void {
  const key = canonicalVariantKey(variantName);
  if (key === 'DEFAULT') {
    throw new Error("Cannot override 'DEFAULT' variant using setVariant, use setDefault instead");
  }
  config.configurations[key] = codingAgent;
}

export function setDefault(config: ExecutorConfig, codingAgent: CodingAgent): void {
  config.configurations['DEFAULT'] = codingAgent;
}

export function variantNames(config: ExecutorConfig): string[] {
  return Object.keys(config.configurations).filter((k) => k !== 'DEFAULT');
}

// --- ExecutorConfigs ---

export interface ExecutorConfigs {
  executors: Record<string, ExecutorConfig>;
}

export function getCodingAgent(configs: ExecutorConfigs, id: ExecutorProfileId): CodingAgent | undefined {
  const executorConfig = configs.executors[id.executor];
  if (!executorConfig) return undefined;
  return getVariant(executorConfig, id.variant ?? 'DEFAULT');
}

export function getCodingAgentOrDefault(configs: ExecutorConfigs, id: ExecutorProfileId): CodingAgent {
  const agent = getCodingAgent(configs, id);
  if (agent) return agent;

  const defaultId: ExecutorProfileId = { executor: id.executor, variant: 'DEFAULT' };
  const defaultAgent = getCodingAgent(configs, defaultId);
  if (!defaultAgent) {
    throw new Error('No default variant found');
  }
  return defaultAgent;
}
