/**
 * Review session management
 * Translates: crates/review/src/claude_session.rs, crates/review/src/session_selector.rs
 */

export interface ReviewSession {
  id: string;
  prNumber: number;
  startedAt: Date;
  messages: SessionMessage[];
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class ReviewSessionManager {
  private sessions: Map<string, ReviewSession> = new Map();

  createSession(prNumber: number): ReviewSession {
    const session: ReviewSession = {
      id: crypto.randomUUID(),
      prNumber,
      startedAt: new Date(),
      messages: []
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push({
        role,
        content,
        timestamp: new Date()
      });
    }
  }
}
