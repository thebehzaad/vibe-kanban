/**
 * Session selector
 * Translates: crates/review/src/session_selector.rs
 *
 * Interactive session selection for reviews.
 */

export interface SessionOption {
  id: string;
  name: string;
  description?: string;
}

export async function selectSession(sessions: SessionOption[]): Promise<string | null> {
  // TODO: Implement interactive session selection
  throw new Error('Not implemented');
}
