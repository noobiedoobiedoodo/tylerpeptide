/**
 * AudioLevelMonitor - High-Fidelity Real-time RMS & Peak Audio Level Monitor
 * 
 * Computes root-mean-square (RMS) energy and peak amplitude from the Web Audio
 * AnalyserNode to diagnose live microphone audio signal flow in real-time.
 */

export interface AudioSignalLevel {
  rms: number;
  peak: number;
}

export class AudioLevelMonitor {
  private analyser: AnalyserNode | null = null;
  private timeData: Uint8Array | null = null;
  private animationFrameId: number | null = null;
  private currentRMS = 0;
  private currentPeak = 0;
  private onLevelChange?: (level: AudioSignalLevel) => void;
  private isMonitoring = false;

  attach(analyser: AnalyserNode, onLevelChange?: (level: AudioSignalLevel) => void) {
    this.analyser = analyser;
    this.onLevelChange = onLevelChange;
    this.timeData = new Uint8Array(analyser.fftSize);
    this.startMonitoring();
  }

  detach() {
    this.stopMonitoring();
    this.analyser = null;
    this.timeData = null;
    this.currentRMS = 0;
    this.currentPeak = 0;
  }

  private startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    const tick = () => {
      if (!this.isMonitoring || !this.analyser || !this.timeData) return;

      this.analyser.getByteTimeDomainData(this.timeData);

      let sumSquares = 0;
      let maxPeak = 0;

      for (let i = 0; i < this.timeData.length; i++) {
        // Time domain is 0..255, centered at 128
        const normalized = (this.timeData[i] - 128) / 128;
        const absVal = Math.abs(normalized);
        if (absVal > maxPeak) maxPeak = absVal;
        sumSquares += normalized * normalized;
      }

      const rawRMS = Math.sqrt(sumSquares / this.timeData.length);
      
      // Smooth dynamic transitions
      this.currentRMS = this.currentRMS * 0.6 + rawRMS * 0.4;
      this.currentPeak = this.currentPeak * 0.7 + maxPeak * 0.3;

      this.onLevelChange?.({
        rms: Number(this.currentRMS.toFixed(3)),
        peak: Number(this.currentPeak.toFixed(3))
      });

      if (typeof window !== 'undefined') {
        this.animationFrameId = requestAnimationFrame(tick);
      }
    };

    if (typeof window !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(tick);
    }
  }

  private stopMonitoring() {
    this.isMonitoring = false;
    if (this.animationFrameId && typeof window !== 'undefined') {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  getCurrentRMS(): number {
    return this.currentRMS;
  }

  getCurrentPeak(): number {
    return this.currentPeak;
  }
}
