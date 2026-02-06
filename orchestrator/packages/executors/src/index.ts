/**
 * @orchestrator/executors
 *
 * AI executor integrations for orchestrator.
 * TypeScript translation of crates/executors.
 *
 * Executors to implement:
 * - Claude (Anthropic)
 * - Cursor
 * - Codex (OpenAI)
 * - Gemini (Google)
 * - Copilot (GitHub)
 * - Qwen (Alibaba)
 * - AMP
 * - Droid
 * - OpenCode
 */

export * from './types.js';
export * from './base.js';
export * from './claude.js';
export * from './cursor.js';
export * from './codex.js';
export * from './gemini.js';
export * from './qwen.js';
export * from './amp.js';
export * from './droid.js';
export * from './opencode.js';
export * as actions from './actions/index.js';
