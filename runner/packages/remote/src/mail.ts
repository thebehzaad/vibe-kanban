/**
 * Email/Mail service
 * Translates: crates/remote/src/mail.rs
 *
 * Email sending service for notifications and alerts.
 */

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  body: string;
  html?: string;
}

export class MailService {
  // TODO: Implement email service
  async sendEmail(message: EmailMessage): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async sendInvitationEmail(email: string, inviterName: string, organizationName: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
