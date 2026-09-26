import { AudioLevelMonitor, AudioSignalLevel } from './AudioLevelMonitor';

/**
 * MicrophoneCapture - Audio Stream & Hardware Capture Manager
 * 
 * Manages getUserMedia hardware stream with echo cancellation, auto gain control,
 * noise suppression, real-time RMS/Peak monitoring, and turn-level MediaRecorder capture.
 */

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private levelMonitor: AudioLevelMonitor = new AudioLevelMonitor();
  private _isActive = false;

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  async start(onAudioLevel?: (level: AudioSignalLevel) => void): Promise<{ stream: MediaStream; analyser: AnalyserNode }> {
    if (this._isActive && this.stream && this.analyser) {
      return { stream: this.stream, analyser: this.analyser };
    }

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser environment.');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false
      });

      this.stream = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.5;

        // Highpass Filter at 110 Hz to suppress HVAC/HRV airflow hum, dryer motor rumble, and ambient low-end vibration
        const highpassFilter = this.audioContext.createBiquadFilter();
        highpassFilter.type = 'highpass';
        highpassFilter.frequency.value = 110;

        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.sourceNode.connect(highpassFilter);
        highpassFilter.connect(this.analyser);

        this.levelMonitor.attach(this.analyser, onAudioLevel);
      }

      this._isActive = true;
      return { stream, analyser: this.analyser! };
    } catch (err: any) {
      this._isActive = false;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission was denied. Please allow microphone access.');
      }
      throw new Error(`Microphone capture failed: ${err.message || 'Device error'}`);
    }
  }

  startTurnRecording() {
    if (!this.stream || typeof window === 'undefined' || !('MediaRecorder' in window)) return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try { this.mediaRecorder.stop(); } catch {}
      }

      this.audioChunks = [];
      const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        ''
      ];
      let mimeType = '';
      for (const t of types) {
        if (!t || (window as any).MediaRecorder?.isTypeSupported?.(t)) {
          mimeType = t;
          break;
        }
      }

      const recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      recorder.start(100);
    } catch (e) {
      console.warn('[MicrophoneCapture] MediaRecorder error:', e);
    }
  }

  async stopTurnRecording(): Promise<{ blob: Blob; mimeType: string } | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder!;
      const mimeType = recorder.mimeType || 'audio/webm';

      recorder.onstop = () => {
        const fullBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];
        this.mediaRecorder = null;
        resolve({ blob: fullBlob, mimeType });
      };

      try {
        if (recorder.state === 'recording') {
          recorder.requestData();
        }
        recorder.stop();
      } catch (err: any) {
        console.warn('[MicrophoneCapture] requestData failed, assembling available chunks', {
          error: err.message,
          media_recorder_state: recorder.state,
          chunks_available: this.audioChunks.length,
          mime_type: mimeType
        });
        const fullBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];
        this.mediaRecorder = null;
        resolve({ blob: fullBlob, mimeType });
      }
    });
  }

  stop() {
    this._isActive = false;
    this.levelMonitor.detach();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch {}
      this.mediaRecorder = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }

    if (this.stream) {
      try {
        this.stream.getTracks().forEach(track => track.stop());
      } catch {}
      this.stream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }

    this.analyser = null;
  }

  isActive(): boolean {
    return this._isActive;
  }

  getSignalLevel(): AudioSignalLevel {
    return {
      rms: this.levelMonitor.getCurrentRMS(),
      peak: this.levelMonitor.getCurrentPeak()
    };
  }
}
