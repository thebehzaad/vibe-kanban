/**
 * Coding agent turn model
 * Translates: crates/db/src/models/coding_agent_turn.rs
 *
 * Tracks individual turns in a coding agent conversation.
 */

export interface CodingAgentTurn {
  id: string;
  executionProcessId: string;
  turnNumber: number;
  agentMessage?: string;
  userMessage?: string;
  timestamp: string;
  createdAt: string;
}

export interface CreateCodingAgentTurn {
  executionProcessId: string;
  turnNumber: number;
  agentMessage?: string;
  userMessage?: string;
}

export class CodingAgentTurnRepository {
  constructor(private db: unknown) {}

  findByExecutionProcessId(executionProcessId: string): CodingAgentTurn[] {
    // TODO: Implement database query
    throw new Error('Not implemented');
  }

  create(data: CreateCodingAgentTurn): CodingAgentTurn {
    // TODO: Implement database insert
    throw new Error('Not implemented');
  }

  findLatestByExecutionProcessId(executionProcessId: string): CodingAgentTurn | null {
    // TODO: Implement database query
    throw new Error('Not implemented');
  }
}
