import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiLiveClient } from '../live/GeminiLiveClient';

describe('Jessica Voice Agent — Echo Cancellation & Repetition Prevention Regression Suite', () => {
  let mockWsInstance: any = null;
  let originalNavigatorDescriptor: any;
  let originalWindow: any;
  let originalWebSocket: any;

  const allSentMessages: string[] = [];

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
      }, 5);
    }
    send(data: string) {
      this.sentMessages.push(data);
      allSentMessages.push(data);
    }
    close(code: number = 1000, reason: string = 'Normal') {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code, reason });
    }
  }

  class MockAudioContext {
    state = 'running';
    sampleRate = 24000;
    currentTime = 0;

    createBufferSource() {
      return {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null
      };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        getByteFrequencyData: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn()
      };
    }
    createScriptProcessor() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null
      };
    }
    createMediaStreamSource() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn()
      };
    }
    createBuffer(channels: number, length: number, sampleRate: number) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length)
      };
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    destination = {};
  }

  beforeEach(() => {
    allSentMessages.length = 0;
    mockWsInstance = null;
    originalWebSocket = (globalThis as any).WebSocket;
    originalWindow = (globalThis as any).window;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    (globalThis as any).WebSocket = MockWebSocket;

    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext
    };

    (globalThis as any).AudioContext = MockAudioContext;

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            active: true,
            getTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }]
          })
        }
      },
      configurable: true,
      writable: true
    });

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
    vi.clearAllMocks();
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
  });

  it('P0 Echo Protection 1: strictly suppresses microphone input within 450ms of Jessica finishing speaking', async () => {
    const client = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: 'conv_echo_test_1' }
    );

    await client.connect();
    await new Promise(r => setTimeout(r, 20));

    // Simulate setup complete
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 150));

    const inputProcessor = (client as any).inputProcessor;
    expect(inputProcessor).toBeDefined();

    // 1. Simulate Jessica playing audio and then completing playback
    (client as any).setState('SPEAKING');
    (client as any).lastNaturalPlaybackEndTime = Date.now();
    (client as any).lastJarvisPlaybackEndTime = Date.now();
    (client as any).setState('LISTENING');

    const initialSentCount = mockWsInstance.sentMessages.length;

    // 2. Room reverberation/speaker ring-down hits mic 100ms later (within 450ms hangover)
    const echoAudioData = new Float32Array(2048);
    echoAudioData.fill(0.035); // Loud room echo of Jessica's voice (RMS = 0.035)

    const echoEvent = {
      inputBuffer: {
        getChannelData: () => echoAudioData,
        length: echoAudioData.length
      },
      outputBuffer: {
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(2048)
      }
    };

    // Feed echo to input processor
    inputProcessor.onaudioprocess(echoEvent);

    // Should NOT send activityStart or audio chunks!
    const newSentMessages = mockWsInstance.sentMessages.slice(initialSentCount);
    const audioOrActivityMessages = newSentMessages.filter((m: string) => {
      return m.includes('activityStart') || m.includes('realtimeInput.audio') || m.includes('audio/pcm');
    });

    expect(audioOrActivityMessages.length).toBe(0);

    client.disconnect();
  });

  it('P0 Echo Protection 2: suppresses decaying room reflections (RMS < 0.024) between 450ms and 850ms', async () => {
    const client = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: 'conv_echo_test_2' }
    );

    await client.connect();
    await new Promise(r => setTimeout(r, 20));

    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 150));

    const inputProcessor = (client as any).inputProcessor;
    expect(inputProcessor).toBeDefined();

    // Simulate Jessica completed playback 600ms ago (in stage 2 window)
    const finishedAt = Date.now() - 600;
    (client as any).lastNaturalPlaybackEndTime = finishedAt;
    (client as any).lastJarvisPlaybackEndTime = finishedAt;

    const initialSentCount = mockWsInstance.sentMessages.length;

    // Decaying reverb tail in resonant room (RMS = 0.018 < 0.024)
    const reverbData = new Float32Array(2048);
    reverbData.fill(0.018);

    inputProcessor.onaudioprocess({
      inputBuffer: { getChannelData: () => reverbData, length: 2048 },
      outputBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(2048) }
    });

    // Reverberation must be blocked!
    const newSent = mockWsInstance.sentMessages.slice(initialSentCount);
    expect(newSent.filter((m: string) => m.includes('activityStart') || m.includes('realtimeInput.audio')).length).toBe(0);

    client.disconnect();
  });

  it('P0 Echo Protection 3: permits intentional customer speech (RMS >= 0.024) after 450ms', async () => {
    const client = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: 'conv_echo_test_3' }
    );

    await client.connect();
    await new Promise(r => setTimeout(r, 20));

    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 150));

    const inputProcessor = (client as any).inputProcessor;
    expect(inputProcessor).toBeDefined();

    // Natural turn completion 500ms ago (customer started answering)
    const finishedAt = Date.now() - 500;
    (client as any).lastNaturalPlaybackEndTime = finishedAt;
    (client as any).lastJarvisPlaybackEndTime = finishedAt;

    const initialSentCount = mockWsInstance.sentMessages.length;

    // Clear human customer voice (RMS = 0.040 >= 0.024)
    const speechData = new Float32Array(2048);
    speechData.fill(0.040);

    inputProcessor.onaudioprocess({
      inputBuffer: { getChannelData: () => speechData, length: 2048 },
      outputBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(2048) }
    });

    // Customer speech MUST be transmitted!
    const newSent = mockWsInstance.sentMessages.slice(initialSentCount);
    const activityStartSent = newSent.some((m: string) => m.includes('activityStart'));
    const audioSent = newSent.some((m: string) => m.includes('realtimeInput.audio') || m.includes('audio/pcm'));

    expect(activityStartSent).toBe(true);
    expect(audioSent).toBe(true);

    client.disconnect();
  });

  it('P0 Barge-In Protection: device speaker bleed (RMS = 0.055) does NOT accidentally abort Jessica mid-speech', async () => {
    const client = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: 'conv_barge_in_test' }
    );

    await client.connect();
    await new Promise(r => setTimeout(r, 20));

    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 150));

    const inputProcessor = (client as any).inputProcessor;
    expect(inputProcessor).toBeDefined();

    // Simulate Jessica actively speaking
    (client as any).setState('SPEAKING');
    (client as any).activeAudioSources = [{}]; // 1 active playing buffer

    // Speaker output bleeds into laptop mic at RMS = 0.055 (above old 0.042 threshold, but below new 0.075 threshold)
    const speakerBleedData = new Float32Array(2048);
    speakerBleedData.fill(0.055);

    for (let frame = 0; frame < 5; frame++) {
      inputProcessor.onaudioprocess({
        inputBuffer: { getChannelData: () => speakerBleedData, length: 2048 },
        outputBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(2048) }
      });
    }

    // Jessica must STILL be speaking! Not aborted by speaker bleed!
    expect(client.getState()).toBe('SPEAKING');
    expect((client as any).activeAudioSources.length).toBe(1);

    client.disconnect();
  });

  it('P0 Greeting Idempotency: greeting does not re-trigger across multiple session instantiations in same tab', async () => {
    // Mock sessionStorage
    const storageMap = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (key: string) => storageMap.get(key) || null,
      setItem: (key: string, val: string) => storageMap.set(key, val),
      removeItem: (key: string) => storageMap.delete(key)
    };

    const convId = 'conv_session_idempotency_123';

    // First client
    const client1 = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: convId }
    );

    await client1.connect();
    await new Promise(r => setTimeout(r, 20));
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 200));

    const countGreetings = () => allSentMessages.filter((m: string) => {
      try {
        const p = JSON.parse(m);
        return p.clientContent?.turns?.[0]?.parts?.[0]?.text?.includes('automotive concierge');
      } catch { return false; }
    }).length;

    expect(countGreetings()).toBe(1);
    client1.disconnect();

    // Second client created with same conversationId (e.g. React remount or reconnect)
    const client2 = new GeminiLiveClient(
      {
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onError: () => {}
      },
      { conversationId: convId }
    );

    await client2.connect();
    await new Promise(r => setTimeout(r, 20));
    mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });
    await new Promise(r => setTimeout(r, 200));

    // Should NOT have sent another greeting! Still exactly 1!
    expect(countGreetings()).toBe(1);

    client2.disconnect();
  });
});
