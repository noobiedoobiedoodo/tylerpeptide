/**
 * videoSoundtrack.ts
 * Web Audio soundtrack generator & recorder bridge for Jessica Promo Video Studio.
 */

class VideoSoundtrackEngine {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isPlaying: boolean = false;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async preloadAssets(): Promise<void> {
    // Pre-warm Web Audio context on user interaction
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  playFullScore(): void {
    this.isPlaying = true;
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } catch (e) {
      console.warn('[SoundtrackEngine] AudioContext resume failed:', e);
    }
  }

  stopAll(): void {
    this.isPlaying = false;
  }

  getAudioStream(): MediaStreamTrack | null {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx && !this.destinationNode) {
        this.destinationNode = this.audioCtx.createMediaStreamDestination();
      }
      return this.destinationNode ? this.destinationNode.stream.getAudioTracks()[0] || null : null;
    } catch (e) {
      console.warn('[SoundtrackEngine] Failed to get audio stream:', e);
      return null;
    }
  }
}

export const soundtrackEngine = new VideoSoundtrackEngine();
