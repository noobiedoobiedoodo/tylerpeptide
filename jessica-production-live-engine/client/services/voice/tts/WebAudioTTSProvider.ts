import { TTSProvider, TTSEvent } from './TTSProvider';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { splitIntoTTSSegments } from './segmentation';
import { SessionController, getActiveSession } from '../SessionController';
import { TurnContext } from '../SessionIdentity';

export type TTSState = 
  | 'TTS_IDLE'
  | 'TTS_REQUESTING'
  | 'TTS_RECEIVING'
  | 'TTS_QUEUED'
  | 'TTS_PLAYING'
  | 'TTS_DRAINING'
  | 'TTS_COMPLETE'
  | 'TTS_INTERRUPTED'
  | 'TTS_ERROR'
  | 'TTS_DEGRADED';

export type SegmentStatus = 
  | 'QUEUED'
  | 'FETCHING'
  | 'DECODING'
  | 'RETRYING'
  | 'READY'
  | 'PLAYING'
  | 'COMPLETED'
  | 'INTERRUPTED'
  | 'FAILED';

export interface TTSSegment {
  id: string;
  index: number;
  text: string;
  wordCount: number;
  charCount: number;
  status: SegmentStatus;
  audioBuffer: AudioBuffer | null;
  durationMs: number;
  startedAt: number | null;
  expectedEndAt: number | null;
  endedAt: number | null;
  generation: number;
}

export class WebAudioTTSProvider implements TTSProvider {
  readonly name = 'EnterpriseWebAudioTTS';
  private state: TTSState = 'TTS_IDLE';
  private audioEngine: WebAudioEngine;

  private currentResponseId = '';
  private currentQueueId = '';
  private segments: TTSSegment[] = [];
  private currentSegmentIndex = 0;
  
  // Pipeline watermark state
  private activeSourceNodes: AudioBufferSourceNode[] = [];
  private nextScheduledTime: number = 0;
  
  private abortController: AbortController | null = null;
  private onEventListener: ((event: TTSEvent, data?: any) => void) | null = null;
  
  constructor() {
    this.audioEngine = WebAudioEngine.getInstance();
  }

  getState(): TTSState {
    return this.state;
  }

  isSpeaking(): boolean {
    return this.state === 'TTS_PLAYING' || this.state === 'TTS_RECEIVING' || this.state === 'TTS_QUEUED' || this.state === 'TTS_DRAINING';
  }

  async speak(text: string, onEvent?: (event: TTSEvent, data?: any) => void): Promise<void> {
    await this.stop('USER_BARGE_IN');

    if (!text || !text.trim()) {
      onEvent?.('COMPLETED');
      return;
    }

    const session = getActiveSession();
    const context = session.contextManager.getCurrentTurnContext();
    const generation = session.contextManager.nextTTSGeneration();
    this.abortController = new AbortController();

    this.onEventListener = onEvent || null;
    this.currentResponseId = `resp_${crypto.randomUUID()}`;
    this.currentQueueId = `queue_${crypto.randomUUID()}`;

    const rawSegments = splitIntoTTSSegments(text);

    this.segments = rawSegments.map((segText, idx) => ({
      id: `${this.currentQueueId}_seg_${idx}`,
      index: idx,
      text: segText,
      wordCount: segText.trim().split(/\s+/).filter(Boolean).length,
      charCount: segText.length,
      status: 'QUEUED',
      audioBuffer: null,
      durationMs: 0,
      startedAt: null,
      expectedEndAt: null,
      endedAt: null,
      generation
    }));

    this.currentSegmentIndex = 0;
    this.nextScheduledTime = 0;
    this.setState('TTS_REQUESTING');

    await this.audioEngine.ensureRunning();

    // Start pipeline
    this.runPipeline(context, generation);
  }

  private async runPipeline(context: TurnContext, generation: number) {
    const LOW_WATERMARK_MS = 1000; 
    const TARGET_BUFFER_MS = 3000;
    const session = getActiveSession();

    let fetchingIndex = 0;

    // Background fetcher
    const fetcher = async () => {
      while (fetchingIndex < this.segments.length) {
        if (!session.contextManager.assertActiveContext(context)) return;
        if (this.abortController?.signal.aborted) return;
        
        let bufferedMs = this.getBufferedDurationMs();
        
        if (bufferedMs < TARGET_BUFFER_MS) {
          const seg = this.segments[fetchingIndex];
          if (seg.status === 'QUEUED') {
            await this.fetchAndDecodeSegment(seg, context, generation);
          }
          fetchingIndex++;
        } else {
          await new Promise(resolve => setTimeout(resolve, 100)); // wait until watermark drops
        }
      }
    };
    fetcher();

    // Foreground player
    while (this.currentSegmentIndex < this.segments.length) {
      if (!session.contextManager.assertActiveContext(context)) return;
      if (this.abortController?.signal.aborted) return;

      const seg = this.segments[this.currentSegmentIndex];
      
      if (seg.status === 'READY' && seg.audioBuffer) {
        if (this.state !== 'TTS_PLAYING') this.setState('TTS_PLAYING');
        await this.schedulePlayback(seg, context, generation);
        this.currentSegmentIndex++;
      } else if (seg.status === 'FAILED') {
        console.warn(`[TTS] Segment ${seg.index} failed. Degraded playback.`);
        this.setState('TTS_DEGRADED');
        this.currentSegmentIndex++;
      } else {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    this.setState('TTS_DRAINING');
    
    // Wait for the scheduled time to pass
    const ctx = this.audioEngine.getAudioContext();
    const remainingTime = this.nextScheduledTime - ctx.currentTime;
    if (remainingTime > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingTime * 1000));
    }

    if (!this.abortController?.signal.aborted) {
      this.setState('TTS_COMPLETE');
      this.onEventListener?.('COMPLETED', { integrity: {} });
    }
  }

  private async schedulePlayback(segment: TTSSegment, context: TurnContext, generation: number): Promise<void> {
    const session = getActiveSession();
    if (!session.contextManager.assertActiveContext(context) || segment.generation !== session.contextManager.getTTSGeneration()) {
      console.warn('[TTS] Discarding stale audio buffer before playback.');
      return;
    }

    const ctx = this.audioEngine.getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = segment.audioBuffer;
    source.connect(ctx.destination);
    
    // Schedule seamlessly
    const startTime = Math.max(ctx.currentTime, this.nextScheduledTime);
    source.start(startTime);
    
    this.nextScheduledTime = startTime + segment.audioBuffer!.duration;
    
    this.activeSourceNodes.push(source);
    segment.status = 'PLAYING';
    segment.startedAt = Date.now();

    return new Promise(resolve => {
      source.onended = () => {
        segment.status = 'COMPLETED';
        segment.endedAt = Date.now();
        this.activeSourceNodes = this.activeSourceNodes.filter(n => n !== source);
        resolve();
      };
    });
  }

  private getBufferedDurationMs(): number {
    return this.segments
      .filter(s => s.status === 'READY')
      .reduce((acc, s) => acc + (s.durationMs || 0), 0);
  }

  private async fetchAndDecodeSegment(segment: TTSSegment, context: TurnContext, generation: number): Promise<void> {
    const signal = this.abortController?.signal;
    let attempts = 0;
    const maxAttempts = 3;
    const session = getActiveSession();

    while (attempts < maxAttempts) {
      if (signal?.aborted) return;
      if (!session.contextManager.assertActiveContext(context)) return;

      try {
        segment.status = attempts === 0 ? 'FETCHING' : 'RETRYING';
        
        // Combine cancellation abort with a 12s hard timeout per segment
        const fetchSignal = signal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
          : signal;

        // Pass generation explicitly to server
        const res = await fetch('/api/tts/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: segment.text,
            voice: 'onyx',
            sessionId: context.sessionId,
            turnId: context.turnId,
            ttsGeneration: generation
          }),
          signal: fetchSignal
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const arrayBuffer = await res.arrayBuffer();
        if (signal?.aborted) return;
        
        const ctx = this.audioEngine.getAudioContext();
        
        segment.status = 'DECODING';
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        if (signal?.aborted) return;
        if (!session.contextManager.assertActiveContext(context)) return;

        segment.audioBuffer = audioBuffer;
        segment.durationMs = audioBuffer.duration * 1000;
        segment.status = 'READY';
        return;

      } catch (err: any) {
        if (err.name === 'AbortError') return;
        attempts++;
        if (attempts >= maxAttempts) {
          // Last-resort: speak locally via browser speechSynthesis
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            try {
              const utterance = new SpeechSynthesisUtterance(segment.text);
              utterance.lang = 'en-GB';
              utterance.rate = 1.0;
              const voices = window.speechSynthesis.getVoices();
              const britishVoice = voices.find(v => v.lang.startsWith('en-GB'));
              if (britishVoice) utterance.voice = britishVoice;
              await new Promise<void>((resolve) => {
                utterance.onend = () => resolve();
                utterance.onerror = () => resolve();
                window.speechSynthesis.speak(utterance);
              });
              segment.status = 'COMPLETED';
              return;
            } catch (synthErr) {
              console.warn('[TTS] Browser speechSynthesis fallback also failed:', synthErr);
            }
          }
          segment.status = 'FAILED';
          return;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  private setState(newState: TTSState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onEventListener?.('state_change' as any, { state: newState });
  }

  async stop(reason?: string): Promise<void> {
    this.abortController?.abort();
    this.activeSourceNodes.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    this.activeSourceNodes = [];
    
    if (this.state !== 'TTS_IDLE' && this.state !== 'TTS_COMPLETE') {
      this.setState('TTS_INTERRUPTED');
      this.onEventListener?.('CANCELLED', { reason });
    }
    
    this.setState('TTS_IDLE');
  }
}
