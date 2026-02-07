/**
 * Notification service
 * Translates: crates/services/src/notification.rs
 */

import { runCommand } from '@runner/utils';

export type NotificationType = 'task_complete' | 'approval_request' | 'error' | 'info';

export interface NotificationOptions {
  title: string;
  body: string;
  type?: NotificationType;
  sound?: boolean;
}

export class NotificationService {
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Send an OS-native notification */
  async send(options: NotificationOptions): Promise<void> {
    if (!this.enabled) return;

    try {
      if (process.platform === 'darwin') {
        await this.sendMacOS(options);
      } else if (process.platform === 'win32') {
        await this.sendWindows(options);
      } else {
        await this.sendLinux(options);
      }
    } catch {
      // Notification failure is non-critical
    }
  }

  /** Send task completion notification */
  async sendTaskComplete(taskTitle: string): Promise<void> {
    await this.send({
      title: 'Task Complete',
      body: `"${taskTitle}" has been completed and is ready for review.`,
      type: 'task_complete',
      sound: true,
    });
  }

  /** Send approval request notification */
  async sendApprovalRequest(description: string): Promise<void> {
    await this.send({
      title: 'Approval Needed',
      body: description,
      type: 'approval_request',
      sound: true,
    });
  }

  private async sendMacOS(options: NotificationOptions): Promise<void> {
    const sound = options.sound ? ' sound name "default"' : '';
    const script = `display notification "${this.escapeAppleScript(options.body)}" with title "${this.escapeAppleScript(options.title)}"${sound}`;
    await runCommand('osascript', ['-e', script]);
  }

  private async sendWindows(options: NotificationOptions): Promise<void> {
    const script = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $textNodes = $template.GetElementsByTagName("text")
      $textNodes.Item(0).AppendChild($template.CreateTextNode("${options.title.replace(/"/g, '`"')}")) > $null
      $textNodes.Item(1).AppendChild($template.CreateTextNode("${options.body.replace(/"/g, '`"')}")) > $null
      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("vibe-kanban").Show($toast)
    `.trim();
    await runCommand('powershell', ['-Command', script]);
  }

  private async sendLinux(options: NotificationOptions): Promise<void> {
    await runCommand('notify-send', [options.title, options.body]);
  }

  private escapeAppleScript(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
