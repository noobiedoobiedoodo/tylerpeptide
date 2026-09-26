import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiLiveClient } from '../live/GeminiLiveClient';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { diagnosticStore } from '../diagnostics/DiagnosticLogger';

describe('JARVIS Static & Disconnect Production Regression Suite', () => {
  let mockWsInstance: any = null;
  let mockAudioContextInstance: any = null;
  let originalWindow: any;
  let originalWebSocket: any;
  let originalNavigatorDescriptor: PropertyDescriptor | undefined;

  class MockAudioBufferSource {
    buffer: any = null;
    onended: (() => void) | null = null;
    started = false;
    stopped = false;
    startTime = 0;
    connect() {}
    disconnect() {}
    start(time: number = 0) {
      this.started = true;
      this.startTime = time;
    }
    stop() {
      this.stopped = true;
      if (this.onended) {
        const cb = this.onended;
        this.onended = null;
        cb();
      }
    }
  }

  class MockAudioContext {
    state: string = 'running';
    sampleRate: number = 24000;
    currentTime: number = 10.5;
    destination: any = {};
    createdSources: MockAudioBufferSource[] = [];
    createdGains: any[] = [];

    createGain() {
      const gainNode = {
        gain: { setValueAtTime: vi.fn(), value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn()
      };
      this.createdGains.push(gainNode);
      return gainNode;
    }
    createAnalyser() {
      return {
        fftSize: 256,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getByteFrequencyData(arr: Uint8Array) { arr.fill(10); },
        getByteTimeDomainData(arr: Uint8Array) { arr.fill(128); }
      };
    }
    createBufferSource() {
      const src = new MockAudioBufferSource();
      this.createdSources.push(src);
      return src;
    }
    createBuffer(channels: number, length: number, sampleRate: number) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        copyToChannel() {},
        getChannelData: () => new Float32Array(length)
      };
    }
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
    createScriptProcessor() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null as any
      };
    }
    isSharedOutput: boolean = true;

    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      if (!this.isSharedOutput) {
        this.state = 'closed';
      }
      return Promise.resolve();
    }
  }

  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    url: string;
    sentMessages: string[] = [];
    bufferedAmount: number = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    onclose: ((event: any) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      mockWsInstance = this;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 10);
    }
    send(data: string) {
      this.sentMessages.push(data);
    }
    close(code: number = 1000, reason: string = 'Normal') {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code, reason });
    }
  }

  function createDummyPcm(sampleCount: number = 600): string {
    const int16 = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      int16[i] = Math.sin(i / 10) * 10000;
    }
    return Buffer.from(int16.buffer).toString('base64');
  }

  beforeEach(() => {
    WebAudioEngine.resetForTesting();
    GeminiLiveClient.resetActiveSocketCountForTesting();
    diagnosticStore.clearEvents();
    diagnosticStore.clearActiveError();
    process.env.GEMINI_API_KEY = 'test-gemini-key-12345';
    mockAudioContextInstance = new MockAudioContext();
    (GeminiLiveClient as any).sharedAudioContext = mockAudioContextInstance;

    originalWindow = (globalThis as any).window;
    originalWebSocket = (globalThis as any).WebSocket;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).window = {
      AudioContext: function () { return mockAudioContextInstance; },
      webkitAudioContext: function () { return mockAudioContextInstance; },
      sessionStorage: {
        store: new Map<string, string>(),
        getItem(k: string) { return this.store.get(k) ?? null; },
        setItem(k: string, v: string) { this.store.set(k, v); },
        removeItem(k: string) { this.store.delete(k); },
        clear() { this.store.clear(); }
      },
      localStorage: {
        store: new Map<string, string>(),
        getItem(k: string) { return this.store.get(k) ?? null; },
        setItem(k: string, v: string) { this.store.set(k, v); },
        removeItem(k: string) { this.store.delete(k); },
        clear() { this.store.clear(); }
      }
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }]
          })
        }
      },
      configurable: true,
      writable: true
    });

    (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 16);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          apiKey: 'test-gemini-key-12345',
          model: 'models/gemini-2.5-flash-native-audio-latest',
          voiceName: 'Puck'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
    vi.restoreAllMocks();
  });

  it('Regression 1: Barge-in does NOT disconnect WebSocket message processing', async () => {
    const transcriptHistory: string[] = [];
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: (t) => { transcriptHistory.push(t.text); },
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 25));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    // 1. Play some audio to start speaking
    client.playAudioChunk(createDummyPcm(1200));
    expect(client.getState()).toBe('SPEAKING');

    // 2. Simulate barge-in via serverContent.interrupted
    mockWsInstance.onmessage?.({
      data: JSON.stringify({ serverContent: { interrupted: true } })
    });

    // 3. Audio should be halted, state should be INTERRUPTED -> transitions to LISTENING
    expect(client.getAudioQueueLength()).toBe(0);
    expect(client.getActivePlayback()).toBeNull();

    // 4. CRITICAL CHECK: Ensure WebSocket onmessage continues to process new messages after barge-in!
    mockWsInstance.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [
              { text: 'I heard you interrupt, what can I help with?' }
            ]
          }
        }
      })
    });

    expect(transcriptHistory).toContain('I heard you interrupt, what can I help with?');
    client.disconnect();
  });

  it('Regression 2: Microphone is NOT silenced after barge-in and sends audio frames', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 25));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    // Barge-in
    mockWsInstance.onmessage?.({
      data: JSON.stringify({ serverContent: { interrupted: true } })
    });

    // Simulate microphone audio processing
    const processor = (client as any).inputProcessor;
    expect(processor).toBeDefined();

    const initialSent = mockWsInstance.sentMessages.length;

    // Simulate voice speech frame
    const audioData = new Float32Array(2048);
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] = Math.sin(i / 5) * 0.2; // clear voice level above noise gate
    }

    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => audioData,
        length: audioData.length
      },
      outputBuffer: {
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(2048)
      }
    });

    // Check that realtimeInput frame was sent to WebSocket after barge-in
    expect(mockWsInstance.sentMessages.length).toBeGreaterThan(initialSent);
    const lastSent = JSON.parse(mockWsInstance.sentMessages[mockWsInstance.sentMessages.length - 1]);
    expect(lastSent.realtimeInput).toBeDefined();

    client.disconnect();
  });

  it('Regression 3: Microphone ScriptProcessorNode output buffer is zeroed out to eliminate speaker feedback while maintaining pull graph', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 25));

    // Check that onaudioprocess fills outputBuffer with 0 to prevent mic-to-speaker feedback
    const processor = (client as any).inputProcessor;
    expect(processor).toBeDefined();

    const outputData = new Float32Array(2048);
    outputData.fill(0.5); // Dirty buffer with static

    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array(2048),
        length: 2048
      },
      outputBuffer: {
        numberOfChannels: 1,
        getChannelData: () => outputData
      }
    });

    // Output buffer must be zeroed out completely
    for (let i = 0; i < outputData.length; i++) {
      expect(outputData[i]).toBe(0);
    }

    client.disconnect();
  });

  it('Regression 4: Odd-byte PCM chunks are buffered to preserve 16-bit sample alignment', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    // Test base64ToFloat32 directly with an odd byte count chunk
    const rawBytes1 = new Uint8Array([0x00, 0x10, 0x20]); // 3 bytes (1 full sample + 1 odd byte)
    const b64_1 = Buffer.from(rawBytes1.buffer).toString('base64');
    const float1 = (client as any).base64ToFloat32(b64_1);

    expect(float1.length).toBe(1); // 1 sample decoded, 1 byte buffered

    // Next chunk supplies the second half of that sample
    const rawBytes2 = new Uint8Array([0x30, 0x00, 0x40]); // 3 bytes
    const b64_2 = Buffer.from(rawBytes2.buffer).toString('base64');
    const float2 = (client as any).base64ToFloat32(b64_2);

    // Buffered byte 0x20 + 0x30 = sample 1, 0x00 + 0x40 = sample 2
    expect(float2.length).toBe(2);
  });
});
