/**
 * Notification service
 * Translates: crates/services/src/services/notification.rs
 *
 * Service for handling cross-platform notifications including sound alerts
 * and push notifications. Supports macOS, Linux, Windows, and WSL2.
 */

import { spawn } from 'node:child_process';

import { isWsl2, getPowerShellScript, getCacheDir } from '@runner/utils';

// ── Config types (will be replaced by imports from config.ts when translated) ──

export type SoundFile =
  | 'ABSTRACT_SOUND_1'
  | 'ABSTRACT_SOUND_2'
  | 'ABSTRACT_SOUND_3'
  | 'ABSTRACT_SOUND_4'
  | 'COW_MOOING'
  | 'PHONE_VIBRATION'
  | 'ROOSTER';

export function soundFileToFilename(sf: SoundFile): string {
  switch (sf) {
    case 'ABSTRACT_SOUND_1': return 'abstract-sound1.wav';
    case 'ABSTRACT_SOUND_2': return 'abstract-sound2.wav';
    case 'ABSTRACT_SOUND_3': return 'abstract-sound3.wav';
    case 'ABSTRACT_SOUND_4': return 'abstract-sound4.wav';
    case 'COW_MOOING': return 'cow-mooing.wav';
    case 'PHONE_VIBRATION': return 'phone-vibration.wav';
    case 'ROOSTER': return 'rooster.wav';
  }
}

export interface NotificationConfig {
  soundEnabled: boolean;
  pushEnabled: boolean;
  soundFile: SoundFile;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  soundEnabled: true,
  pushEnabled: true,
  soundFile: 'COW_MOOING',
};

/**
 * Minimal Config interface for notification service.
 * Will be replaced by full Config import when config module is translated.
 */
export interface NotificationServiceConfig {
  notifications: NotificationConfig;
}

// ── Cached WSL root path ──

let wslRootPathCache: string | null | undefined;

// ── NotificationService ──

export class NotificationService {
  private config: NotificationServiceConfig;

  constructor(config: NotificationServiceConfig) {
    this.config = config;
  }

  /** Update config reference (for hot-reloading) */
  updateConfig(config: NotificationServiceConfig): void {
    this.config = config;
  }

  /** Send both sound and push notifications if enabled */
  async notify(title: string, message: string): Promise<void> {
    const notifConfig = this.config.notifications;
    await NotificationService.sendNotification(notifConfig, title, message);
  }

  /** Internal method to send notifications with a given config */
  private static async sendNotification(
    config: NotificationConfig,
    title: string,
    message: string,
  ): Promise<void> {
    if (config.soundEnabled) {
      await NotificationService.playSoundNotification(config.soundFile);
    }

    if (config.pushEnabled) {
      await NotificationService.sendPushNotification(title, message);
    }
  }

  /** Play a system sound notification across platforms */
  private static async playSoundNotification(soundFile: SoundFile): Promise<void> {
    const filePath = await NotificationService.getSoundFilePath(soundFile);
    if (!filePath) return;

    // Fire-and-forget: spawn() calls are intentionally not awaited
    if (process.platform === 'darwin') {
      spawn('afplay', [filePath], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'linux' && !isWsl2()) {
      // Try different Linux audio players
      const child = spawn('paplay', [filePath], { stdio: 'ignore' });
      child.on('error', () => {
        const child2 = spawn('aplay', [filePath], { stdio: 'ignore' });
        child2.on('error', () => {
          // Try system bell as fallback
          spawn('echo', ['-e', '\\a'], { stdio: 'ignore' }).unref();
        });
        child2.unref();
      });
      child.unref();
    } else if (process.platform === 'win32' || (process.platform === 'linux' && isWsl2())) {
      // Convert WSL path to Windows path if in WSL2
      const windowsPath = isWsl2()
        ? (await NotificationService.wslToWindowsPath(filePath)) ?? filePath
        : filePath;

      spawn('powershell.exe', [
        '-c',
        `(New-Object Media.SoundPlayer "${windowsPath}").PlaySync()`,
      ], { stdio: 'ignore', detached: true }).unref();
    }
  }

  /** Get or create a cached sound file path */
  private static async getSoundFilePath(soundFile: SoundFile): Promise<string | null> {
    try {
      const filename = soundFileToFilename(soundFile);
      const cacheDir = getCacheDir();
      const cachedPath = `${cacheDir}/sound-${filename}`;

      // Check if cached file exists
      const fs = await import('node:fs');
      if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
        return cachedPath;
      }

      // TODO: Extract embedded sound file to cache
      // For now, return null if sound file not cached
      console.debug(`Sound file not found in cache: ${cachedPath}`);
      return null;
    } catch (e) {
      console.error(`Failed to create cached sound file: ${e}`);
      return null;
    }
  }

  /** Send a cross-platform push notification */
  private static async sendPushNotification(title: string, message: string): Promise<void> {
    if (process.platform === 'darwin') {
      await NotificationService.sendMacosNotification(title, message);
    } else if (process.platform === 'linux' && !isWsl2()) {
      NotificationService.sendLinuxNotification(title, message);
    } else if (process.platform === 'win32' || (process.platform === 'linux' && isWsl2())) {
      await NotificationService.sendWindowsNotification(title, message);
    }
  }

  /** Send macOS notification using osascript */
  private static async sendMacosNotification(title: string, message: string): Promise<void> {
    const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "Glass"`;

    spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
  }

  /** Send Linux notification using notify-send / notify-rust equivalent */
  private static sendLinuxNotification(title: string, message: string): void {
    spawn('notify-send', [title, message, '--expire-time=10000'], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  }

  /** Send Windows/WSL notification using PowerShell toast script */
  private static async sendWindowsNotification(title: string, message: string): Promise<void> {
    let scriptPath: string;
    try {
      scriptPath = await getPowerShellScript();
    } catch (e) {
      console.error(`Failed to get PowerShell script: ${e}`);
      return;
    }

    // Convert WSL path to Windows path if in WSL2
    const scriptPathStr = isWsl2()
      ? (await NotificationService.wslToWindowsPath(scriptPath)) ?? scriptPath
      : scriptPath;

    spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPathStr,
      '-Title', title,
      '-Message', message,
    ], { stdio: 'ignore', detached: true }).unref();
  }

  /** Get WSL root path via PowerShell (cached) */
  private static async getWslRootPath(): Promise<string | null> {
    if (wslRootPathCache !== undefined) {
      return wslRootPathCache;
    }

    return new Promise<string | null>((resolve) => {
      const child = spawn('powershell.exe', [
        '-c',
        "(Get-Location).Path -replace '^.*::', ''",
      ], { cwd: '/' });

      let stdout = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          const pwd = stdout.trim();
          console.log(`WSL root path detected: ${pwd}`);
          wslRootPathCache = pwd;
          resolve(pwd);
        } else {
          console.error('Failed to detect WSL root path');
          wslRootPathCache = null;
          resolve(null);
        }
      });

      child.on('error', (e) => {
        console.error(`Failed to execute PowerShell pwd command: ${e}`);
        wslRootPathCache = null;
        resolve(null);
      });
    });
  }

  /** Convert WSL path to Windows UNC path for PowerShell */
  private static async wslToWindowsPath(wslPath: string): Promise<string | null> {
    // Relative paths work fine as-is in PowerShell
    if (!wslPath.startsWith('/')) {
      console.debug(`Using relative path as-is: ${wslPath}`);
      return wslPath;
    }

    // Get cached WSL root path from PowerShell
    const wslRoot = await NotificationService.getWslRootPath();
    if (wslRoot) {
      // Simply concatenate WSL root with the absolute path
      const windowsPath = `${wslRoot}${wslPath}`;
      console.debug(`WSL path converted: ${wslPath} -> ${windowsPath}`);
      return windowsPath;
    }

    console.error(`Failed to determine WSL root path for conversion: ${wslPath}`);
    return null;
  }
}
