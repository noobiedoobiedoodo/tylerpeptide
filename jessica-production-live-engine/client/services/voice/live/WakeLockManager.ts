/**
 * src/services/voice/live/WakeLockManager.ts
 * 
 * Production Screen Keep-Awake Manager for Jarvis Voice Sessions.
 * 
 * Prevents mobile devices (iOS Safari, Android Chrome, Samsung Internet)
 * from dimming, timing out, or locking the screen while the user is talking
 * hands-free with Jarvis.
 * 
 * Architecture:
 * 1. Primary: W3C Screen Wake Lock API (navigator.wakeLock.request('screen'))
 * 2. Automatic Re-acquisition: Listens to 'visibilitychange' to restore lock on return to tab
 * 3. Media Fallback: Invisible looped 1x1 micro-video (NoSleep pattern) for legacy/restricted WebKit
 * 4. Observable State: Emits active status changes for UI badges / HUD feedback
 */

export class WakeLockManager {
  private static instance: WakeLockManager | null = null;
  private wakeLockSentinel: any = null;
  private fallbackVideo: HTMLVideoElement | null = null;
  private isRequested = false;
  private isActuallyLocked = false;
  private listeners: Set<(active: boolean) => void> = new Set();
  private visibilityHandler: (() => void) | null = null;

  private constructor() {
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => this.handleVisibilityChange();
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  public static getInstance(): WakeLockManager {
    if (!WakeLockManager.instance) {
      WakeLockManager.instance = new WakeLockManager();
    }
    return WakeLockManager.instance;
  }

  /**
   * Requests continuous screen keep-awake.
   * Safe to call repeatedly and idempotent.
   */
  public async request(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    this.isRequested = true;

    // 1. Attempt primary W3C Screen Wake Lock API
    const nativeSuccess = await this.acquireNativeWakeLock();

    // 2. Activate auxiliary media fallback for maximum reliability across mobile Safari/WebKit
    this.startMediaFallback();

    const active = nativeSuccess || Boolean(this.fallbackVideo);
    this.setLockedState(active);
    return active;
  }

  /**
   * Releases screen keep-awake and restores normal device sleep behavior.
   */
  public async release(): Promise<void> {
    this.isRequested = false;

    // Release native sentinel
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
    }

    // Stop media fallback
    this.stopMediaFallback();
    this.setLockedState(false);
  }

  /**
   * Returns whether the screen is currently being kept awake.
   */
  public isLocked(): boolean {
    return this.isActuallyLocked;
  }

  /**
   * Subscribe to lock state changes for UI HUD updates.
   */
  public onStateChange(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isActuallyLocked);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internal Helpers ────────────────────────────────────────────────────────

  private async acquireNativeWakeLock(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return false;
    }

    try {
      if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
        return true;
      }

      const sentinel = await (navigator as any).wakeLock.request('screen');
      this.wakeLockSentinel = sentinel;

      sentinel.addEventListener('release', () => {
        // If released by OS (e.g. low battery, screen lock), re-acquire when visible
        if (this.isRequested && typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.acquireNativeWakeLock().then(ok => this.setLockedState(ok));
        } else {
          this.setLockedState(false);
        }
      });

      console.log('[WakeLockManager] Screen Wake Lock successfully acquired.');
      return true;
    } catch (err: any) {
      console.warn('[WakeLockManager] Native screen wakeLock request denied or unsupported:', err?.message || err);
      return false;
    }
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return;

    if (document.visibilityState === 'visible' && this.isRequested) {
      console.log('[WakeLockManager] Tab returned to foreground, re-engaging keep-awake...');
      this.acquireNativeWakeLock().then(ok => {
        if (!ok) {
          this.startMediaFallback();
        }
        this.setLockedState(ok || Boolean(this.fallbackVideo));
      });
    }
  }

  private startMediaFallback(): void {
    if (typeof document === 'undefined') return;
    if (this.fallbackVideo) return;

    try {
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';

      // Minimal 1x1 blank MP4 byte stream to prevent mobile sleep
      video.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAADFtb292AAAAbG12aGQAAAAA10a2rddGtqwAAAPoAAAAAAABAAFTcmVmAAAAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAABidHJhawAAACx0a2hkAAAABNdGtq3XRtasAAAAAQAAAAAAAAPoAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAbWRpYQAAACBtZGhkAAAAANdGtq3XRtasAAAPoAAAAAAAVxAAAAAAACxoZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAAAAAAAABgG1pbmYAAAAUc21oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAALZzdGJsAAAAmXN0c2QAAAAAAAAAAQAAAI5tcDRhAAAAAAEAAAAAAAAAAgAAAAAAAAAAAQAAAAAAAFcQAAAAAAACAAAAbWVzcwAAAA0AAAABAAAABAAAAAwAAAAcAAAAEGVzZHMBAAAAAACBAAAA';

      document.body.appendChild(video);
      const promise = video.play();
      if (promise !== undefined) {
        promise.catch(() => {
          // Playback might be blocked until direct user interaction, safe to ignore
        });
      }
      this.fallbackVideo = video;
    } catch {
      // Non-fatal fallback notice
    }
  }

  private stopMediaFallback(): void {
    if (this.fallbackVideo) {
      try {
        this.fallbackVideo.pause();
        this.fallbackVideo.removeAttribute('src');
        this.fallbackVideo.load();
        if (this.fallbackVideo.parentNode) {
          this.fallbackVideo.parentNode.removeChild(this.fallbackVideo);
        }
      } catch {}
      this.fallbackVideo = null;
    }
  }

  private setLockedState(locked: boolean): void {
    if (this.isActuallyLocked !== locked) {
      this.isActuallyLocked = locked;
      for (const listener of this.listeners) {
        try { listener(locked); } catch {}
      }
    }
  }
}
