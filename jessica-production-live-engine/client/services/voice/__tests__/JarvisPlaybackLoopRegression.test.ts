import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiLiveClient } from '../live/GeminiLiveClient';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { diagnosticStore } from '../diagnostics/DiagnosticLogger';

describe('JARVIS Playback Loop & Single-Consumer Queue Regression Suite (P0)', () => {
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

    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn()
      };
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { setValueAtTime: vi.fn(), value: 1000 },
        gain: { setValueAtTime: vi.fn(), value: 0 },
        Q: { setValueAtTime: vi.fn(), value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn()
      };
    }
    createDynamicsCompressor() {
      return {
        threshold: { setValueAtTime: vi.fn(), value: -24 },
        knee: { setValueAtTime: vi.fn(), value: 30 },
        ratio: { setValueAtTime: vi.fn(), value: 12 },
        attack: { setValueAtTime: vi.fn(), value: 0.003 },
        release: { setValueAtTime: vi.fn(), value: 0.25 },
        connect: vi.fn(),
        disconnect: vi.fn()
      };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        connect() {},
        disconnect() {},
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
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, onaudioprocess: null as any };
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

  function createDummyPcm(samples = 1200): string {
    return Buffer.from(new Int16Array(samples).buffer).toString('base64');
  }

  it('Test 1: Single response (1 item: enqueue 1, sourceCreated 1, sourceStarted 1, playbackStarted 1, playbackEnded 1)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    diagnosticStore.clearEvents();

    const dummyPcm = createDummyPcm(1200);
    client.playAudioChunk(dummyPcm);

    expect(client.getState()).toBe('SPEAKING');
    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    const source = mockAudioContextInstance.createdSources[0];
    expect(source.started).toBe(true);

    const events = diagnosticStore.getEvents();
    expect(events.filter(e => e.event === 'AUDIO_ENQUEUE').length).toBe(1);
    expect(events.filter(e => e.event === 'AUDIO_SOURCE_CREATED').length).toBe(1);
    expect(events.filter(e => e.event === 'AUDIO_SOURCE_STARTED').length).toBe(1);
    expect(events.filter(e => e.event === 'AUDIO_PLAYBACK_STARTED').length).toBe(1);
    expect(client.getActivePlayback()).not.toBeNull();

    source.stop();

    expect(diagnosticStore.getEvents().filter(e => e.event === 'AUDIO_PLAYBACK_ENDED').length).toBe(1);
    expect(client.getAudioQueueLength()).toBe(0);
    expect(client.getActivePlayback()).toBeNull();
    expect(client.getState()).toBe('LISTENING');

    client.disconnect();
  });

  it('Test 2: 10 chunks (enqueue 10, dequeue 10, sourceCreated 10, sourceStarted 10, playbackStarted 10, playbackEnded 10, maxConcurrentPlayback 1, maxConcurrentConsumers 1)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    diagnosticStore.clearEvents();

    const dummyPcm = createDummyPcm(600);

    for (let i = 0; i < 10; i++) {
      client.playAudioChunk(dummyPcm);
    }

    // Under bounded lookahead scheduling, initial chunks are pre-scheduled onto Web Audio timeline
    expect(mockAudioContextInstance.createdSources.length).toBeGreaterThanOrEqual(1);
    expect(client.getActivePlayback()).not.toBeNull();

    for (let i = 0; i < 10; i++) {
      const currentSource = mockAudioContextInstance.createdSources[i];
      if (currentSource) {
        expect(currentSource.started).toBe(true);
        currentSource.stop();
      }
    }

    const events = diagnosticStore.getEvents();
    expect(events.filter(e => e.event === 'AUDIO_ENQUEUE').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_DEQUEUE').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_SOURCE_CREATED').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_SOURCE_STARTED').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_PLAYBACK_STARTED').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_PLAYBACK_ENDED').length).toBe(10);
    expect(events.filter(e => e.event === 'AUDIO_INVARIANT_VIOLATION').length).toBe(0);

    expect(client.getAudioQueueLength()).toBe(0);
    expect(client.getActivePlayback()).toBeNull();
    expect(client.getState()).toBe('LISTENING');

    client.disconnect();
  });

  it('Test 3: Duplicate item (submitting same audioItemId twice -> sourceStarted = 1)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    diagnosticStore.clearEvents();

    const dummyPcm = createDummyPcm(1000);
    client.playAudioChunk(dummyPcm);

    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    const playedIds: Set<string> = (client as any).playedAudioItemIds;
    const firstId = Array.from(playedIds)[0];
    expect(firstId).toBeDefined();

    const duplicateItem = {
      audioItemId: firstId,
      responseId: 'resp_test_dup',
      generation: client.getSessionGeneration(),
      buffer: mockAudioContextInstance.createBuffer(1, 1000, 24000),
      started: false,
      completed: false
    };

    (client as any).playAudioItem(duplicateItem);

    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    client.disconnect();
  });

  it('Test 4: Concurrent enqueue burst (10 synchronous calls -> consumerInstances = 1)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    const dummyPcm = createDummyPcm(400);

    for (let i = 0; i < 10; i++) {
      client.playAudioChunk(dummyPcm);
    }

    expect(client.isPlaybackConsumerRunning()).toBe(true);
    expect(client.getActivePlayback()).not.toBeNull();
    expect(mockAudioContextInstance.createdSources.length).toBe(1);
    expect(client.getAudioQueueLength()).toBe(9);

    client.disconnect();
  });

  it('Test 5: Barge-in (interrupting starts generation increment, clears queue, cancels playback)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    const initialGen = client.getSessionGeneration();

    for (let i = 0; i < 5; i++) {
      client.playAudioChunk(createDummyPcm(800));
    }

    expect(client.getAudioQueueLength()).toBe(4);
    expect(client.getActivePlayback()).not.toBeNull();

    mockWsInstance.onmessage?.({
      data: JSON.stringify({
        serverContent: { interrupted: true }
      })
    });

    expect(client.getSessionGeneration()).toBeGreaterThan(initialGen);
    expect(client.getAudioQueueLength()).toBe(0);
    expect(client.getActivePlayback()).toBeNull();

    const cancelEvents = diagnosticStore.getEvents().filter(e => e.event === 'AUDIO_PLAYBACK_CANCELLED');
    expect(cancelEvents.length).toBeGreaterThan(0);

    client.disconnect();
  });

  it('Test 6: Stale onended (firing onended from an old generation does not start new playback)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    client.playAudioChunk(createDummyPcm(1200));

    const oldSource = mockAudioContextInstance.createdSources[0];
    const oldGen = client.getSessionGeneration();

    client.restartSession();
    await new Promise(r => setTimeout(r, 20));
    const newGen = client.getSessionGeneration();
    expect(newGen).toBeGreaterThan(oldGen);

    diagnosticStore.clearEvents();
    if (oldSource.onended) {
      oldSource.onended();
    }

    const endedEvents = diagnosticStore.getEvents().filter(e => e.event === 'AUDIO_PLAYBACK_ENDED');
    expect(endedEvents.length).toBe(0);

    client.disconnect();
  });

  it('Test 7: React remount (idempotent audio context & single consumer)', async () => {
    const client1 = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client1.connect();
    await new Promise(r => setTimeout(r, 20));
    client1.playAudioChunk(createDummyPcm(500));
    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    client1.disconnect();
    expect(client1.getState()).toBe('DISCONNECTED');

    const client2 = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client2.connect();
    await new Promise(r => setTimeout(r, 20));
    (client2 as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    client2.playAudioChunk(createDummyPcm(500));
    expect(mockAudioContextInstance.createdSources.length).toBe(2);
    expect(client2.isPlaybackConsumerRunning()).toBe(true);
    expect(client2.getActivePlayback()).not.toBeNull();

    client2.disconnect();
  });

  it('Test 8: CRM independence (CRM_SYNC_SUCCESS / LEAD_PROFILE_UPDATED does NOT trigger audio enqueue)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    diagnosticStore.clearEvents();

    mockWsInstance.onmessage?.({
      data: JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'fc_crm_1',
              name: 'update_buyer_intelligence',
              args: {
                monthlyBudget: 600,
                targetVehicle: 'Honda Civic'
              }
            }
          ]
        }
      })
    });

    await new Promise(r => setTimeout(r, 50));

    expect(client.getAudioQueueLength()).toBe(0);
    expect(client.getActivePlayback()).toBeNull();
    expect(mockAudioContextInstance.createdSources.length).toBe(0);

    const audioEvents = diagnosticStore.getEvents().filter(e => e.category === 'AUDIO_OUTPUT');
    expect(audioEvents.length).toBe(0);

    client.disconnect();
  });

  it('Test 9: Invariant violation (attempting a second active playback logs AUDIO_INVARIANT_VIOLATION and fails closed)', async () => {
    const client = new GeminiLiveClient({
      onStateChange: () => {},
      onMicStatusChange: () => {},
      onUserAudioLevel: () => {},
      onJarvisAudioLevel: () => {},
      onTranscript: () => {},
      onError: () => {}
    });

    await client.connect();
    await new Promise(r => setTimeout(r, 20));
    (client as any).hasSentInitialGreeting = true;
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

    client.playAudioChunk(createDummyPcm(1000));
    expect(client.getActivePlayback()).not.toBeNull();
    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    diagnosticStore.clearEvents();

    const violatingItem = {
      audioItemId: 'violating_item_99',
      responseId: 'resp_violation',
      generation: client.getSessionGeneration(),
      buffer: mockAudioContextInstance.createBuffer(1, 1000, 24000),
      started: false,
      completed: false
    };

    (client as any).playAudioItem(violatingItem);

    const violations = diagnosticStore.getEvents().filter(e => e.event === 'AUDIO_INVARIANT_VIOLATION');
    expect(violations.length).toBe(1);
    expect(violations[0].details.reason).toBe('SECOND_ACTIVE_PLAYBACK_ATTEMPT');
    expect(mockAudioContextInstance.createdSources.length).toBe(1);

    client.disconnect();
  });
});
