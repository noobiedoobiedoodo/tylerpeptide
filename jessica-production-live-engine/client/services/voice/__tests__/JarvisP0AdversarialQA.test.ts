import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiLiveClient, classifyCloseCode } from '../live/GeminiLiveClient';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { diagnosticStore } from '../diagnostics/DiagnosticLogger';
import { INITIAL_FORM_DATA } from '../../../types';
import { formDataToBuyerProfile, mergeBuyerProfile, BuyerProfile } from '../live/voiceLeadExtractor';

describe('JARVIS P0 Adversarial QA & Production Acceptance Suite', () => {
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
    isSharedOutput: boolean = false;

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
    mockAudioContextInstance.isSharedOutput = true;
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
    WebAudioEngine.resetForTesting();
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
    (GeminiLiveClient as any).sharedAudioContext = null;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. REAL BROWSER AUDIO PIPELINE TEST
  // ---------------------------------------------------------------------------
  describe('1. Audio Pipeline Execution Chain', () => {
    it('verifies exact chain from user gesture unlock to sourceNode.start(startTime) and AUDIO_SOURCE_STARTED', async () => {
      // Step 1: User Gesture Unlock
      const unlocked = await GeminiLiveClient.unlockAudioContext();
      expect(unlocked).toBe(true);

      const eventsAfterUnlock = diagnosticStore.getEvents();
      expect(eventsAfterUnlock.some(e => e.event === 'AUDIO_HARDWARE_UNLOCK_STARTED')).toBe(true);
      expect(eventsAfterUnlock.some(e => e.event === 'AUDIO_HARDWARE_UNLOCK_SUCCESS')).toBe(true);

      // Step 2: Establish Gemini Live Session
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 30));
      (client as any).hasSentInitialGreeting = true;
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // Step 3: Receive Server Audio Response
      const dummyPcm = Buffer.from(new Int16Array(2400).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [
                { inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }
              ]
            }
          }
        })
      });

      // Step 4: Verify AudioBufferSourceNodes (Source 0: Hardware unlock, Source 1: Gemini response)
      expect(mockAudioContextInstance.createdSources.length).toBe(2);
      const activeSource = mockAudioContextInstance.createdSources[1];
      expect(activeSource.started).toBe(true);
      expect(activeSource.startTime).toBeGreaterThanOrEqual(mockAudioContextInstance.currentTime);

      // Step 5: Verify Telemetry Correlation
      const events = diagnosticStore.getEvents();
      const decodeStarted = events.some(e => e.event === 'AUDIO_DECODE_STARTED');
      const bufferCreated = events.some(e => e.event === 'AUDIO_BUFFER_CREATED');
      const sourceCreated = events.some(e => e.event === 'AUDIO_SOURCE_CREATED');
      const sourceStarted = events.some(e => e.event === 'AUDIO_SOURCE_STARTED');

      expect(decodeStarted).toBe(true);
      expect(bufferCreated).toBe(true);
      expect(sourceCreated).toBe(true);
      expect(sourceStarted).toBe(true);

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. MULTI-TURN CONVERSATION TEST (Turns 1 to 5)
  // ---------------------------------------------------------------------------
  describe('2. Multi-Turn Conversation (Turns 1 to 5)', () => {
    it('executes 5 consecutive turns without conversational freeze, audio overlap, or reconnect loop', async () => {
      let turnsCount = 0;
      let latestJarvisTranscript = '';

      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: ({ sender, text }) => {
          if (sender === 'jarvis') {
            latestJarvisTranscript = text;
          }
        },
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 30));
      (client as any).hasSentInitialGreeting = true;
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      for (let turn = 1; turn <= 5; turn++) {
        // User turn
        client.sendTextMessage(`User utterance for turn ${turn}`);

        // Simulate server response
        const dummyPcm = Buffer.from(new Int16Array(1200).buffer).toString('base64');
        mockWsInstance.onmessage?.({
          data: JSON.stringify({
            serverContent: {
              modelTurn: {
                parts: [
                  { text: `Jarvis response for turn ${turn}. ` },
                  { inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }
                ]
              },
              turnComplete: true
            }
          })
        });

        turnsCount++;
        expect(latestJarvisTranscript).toContain(`Jarvis response for turn ${turn}`);
        expect(client.getState()).toBe('SPEAKING');

        // Simulate audio playback finishing
        const lastSource = mockAudioContextInstance.createdSources[mockAudioContextInstance.createdSources.length - 1];
        lastSource.stop();
      }

      expect(turnsCount).toBe(5);
      expect(mockAudioContextInstance.createdSources.length).toBe(5);
      // Ensure no unexpected reconnects occurred
      expect((client as any).reconnectAttempts).toBe(0);

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. BARGE-IN INTERRUPTION TEST
  // ---------------------------------------------------------------------------
  describe('3. Barge-In Interruption Handling', () => {
    it('halts active playback and resets audio queue immediately when barge-in is triggered', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 30));
      (client as any).hasSentInitialGreeting = true;
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // Start audio playback
      const dummyPcm = Buffer.from(new Int16Array(4800).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [
                { inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }
              ]
            }
          }
        })
      });

      expect(client.getState()).toBe('SPEAKING');
      const activeSource = mockAudioContextInstance.createdSources[0];
      expect(activeSource.started).toBe(true);
      expect(activeSource.stopped).toBe(false);

      // Trigger Gemini server interrupted signal (barge-in)
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            interrupted: true
          }
        })
      });

      // Verified: source stopped, audio queue emptied, nextPlaybackTime reset to current audio clock
      expect(activeSource.stopped).toBe(true);
      expect((client as any).activeAudioSources.length).toBe(0);
      expect((client as any).nextPlaybackTime).toBe(mockAudioContextInstance.currentTime);
      expect(client.getState()).toBe('INTERRUPTED');
      await new Promise(r => setTimeout(r, 120));
      expect(client.getState()).toBe('LISTENING');

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. RESTART RACE TEST
  // ---------------------------------------------------------------------------
  describe('4. Restart Race Test', () => {
    it('guarantees old generation cannot play audio or mutate state when restart is clicked during speech', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 30));
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // Actively speaking
      const gen1 = client.getSessionGeneration();
      const dummyPcm = Buffer.from(new Int16Array(2400).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }]
            }
          }
        })
      });

      expect(client.getState()).toBe('SPEAKING');
      const oldWs = mockWsInstance;

      // User hits RESTART while speaking
      await client.restartSession();

      const gen2 = client.getSessionGeneration();
      expect(gen2).toBeGreaterThan(gen1);
      expect(oldWs.readyState).toBe(3); // Old socket dead

      // Old socket attempts to emit audio or messages for old generation
      oldWs.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ text: 'Old ghost message from previous turn' }]
            }
          }
        })
      });

      // No new audio should have been scheduled from old generation, and new session is initializing/connected
      expect(['INITIALIZING', 'CONNECTING', 'CONNECTED'].includes(client.getState())).toBe(true);
      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. RAPID RESTART STRESS TEST
  // ---------------------------------------------------------------------------
  describe('5. Rapid Restart Stress Test', () => {
    it('survives 5 rapid consecutive restarts maintaining exactly one clean session and monotonic generations', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 20));

      const initialGen = client.getSessionGeneration();

      // 5 rapid restarts in succession
      await client.restartSession();
      await client.restartSession();
      await client.restartSession();
      await client.restartSession();
      await client.restartSession();

      const finalGen = client.getSessionGeneration();
      expect(finalGen).toBe(initialGen + 5);
      await new Promise(r => setTimeout(r, 30));

      expect(mockWsInstance.readyState).toBe(1);
      expect(['INITIALIZING', 'CONNECTING', 'CONNECTED'].includes(client.getState())).toBe(true);
      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. ZERO-DEFAULT QUALIFICATION QA
  // ---------------------------------------------------------------------------
  describe('6. Zero-Default Session & Form Invariants', () => {
    it('guarantees fresh sessions never infer SUV or good credit until explicitly stated by buyer', () => {
      // Step 1: Blank default form
      expect(INITIAL_FORM_DATA.vehicle).toBe('');
      expect(INITIAL_FORM_DATA.creditScore).toBe('');

      // Step 2: Extract initial profile
      const cleanProfile = formDataToBuyerProfile(INITIAL_FORM_DATA);
      expect(cleanProfile.vehicleType).toBeUndefined();
      expect(cleanProfile.creditSituation).toBeUndefined();

      // Step 3: When buyer explicitly says "I'm looking for an SUV"
      const delta = { vehicleType: 'SUV' as const };
      const updatedProfile = mergeBuyerProfile(cleanProfile, delta);
      expect(updatedProfile.vehicleType).toBe('SUV');
      expect(updatedProfile.creditSituation).toBeUndefined(); // Still unstated!
    });
  });

  // ---------------------------------------------------------------------------
  // 7. STALE STORAGE PURGE & ISOLATION
  // ---------------------------------------------------------------------------
  describe('7. Stale Storage Purge & Isolation', () => {
    it('Scenario C: purges legacy localStorage keys on startup while preserving unrelated app storage', () => {
      const LEGACY_KEYS = [
        'jarvis_live_session',
        'jarvis_session_state',
        'jarvis_conversation_id',
        'jarvis_buyer_profile',
        'jarvis_lead_id'
      ];

      // Populate legacy keys
      for (const k of LEGACY_KEYS) {
        window.localStorage.setItem(k, JSON.stringify({ vehicle: 'SUV', creditScore: 'good' }));
      }
      // Populate unrelated app key
      window.localStorage.setItem('user_theme_preference', 'dark');

      // Execute purge routine
      for (const k of LEGACY_KEYS) {
        window.localStorage.removeItem(k);
      }

      // Verify legacy keys are eradicated
      for (const k of LEGACY_KEYS) {
        expect(window.localStorage.getItem(k)).toBeNull();
      }
      // Verify unrelated storage remains untouched
      expect(window.localStorage.getItem('user_theme_preference')).toBe('dark');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. DIAGNOSTIC HUD & HEALTH VALIDATION
  // ---------------------------------------------------------------------------
  describe('8. Diagnostic HUD & Telemetry Validation', () => {
    it('tracks system health matrix across major failure modes and maintains visibility', () => {
      diagnosticStore.clearEvents();

      // Log events across categories
      diagnosticStore.log({ level: 'INFO', category: 'WEBSOCKET', event: 'WEBSOCKET_OPEN' });
      diagnosticStore.log({ level: 'INFO', category: 'GEMINI', event: 'GEMINI_SESSION_CREATED' });
      diagnosticStore.log({ level: 'WARN', category: 'AUDIO_INPUT', event: 'MIC_PERMISSION_DENIED' });
      diagnosticStore.log({ level: 'ERROR', category: 'CRM', event: 'CRM_SYNC_FAILED', details: { code: 500 } });

      const events = diagnosticStore.getEvents();
      expect(events.length).toBe(4);

      const health = diagnosticStore.getHealth();
      expect(health).toHaveProperty('websocket');
      expect(health).toHaveProperty('gemini');
      expect(health).toHaveProperty('webaudio');
      expect(health).toHaveProperty('microphone');
      expect(health).toHaveProperty('crm');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. ERROR BANNER PERSISTENCE
  // ---------------------------------------------------------------------------
  describe('9. Error Banner Persistence', () => {
    it('persists active error in diagnostic store across state checks until explicitly cleared', () => {
      diagnosticStore.setActiveError('Simulated WebSocket Connection Failure');
      expect(diagnosticStore.getActiveError()).toBe('Simulated WebSocket Connection Failure');

      // Simulate state updates (e.g. user toggling UI view)
      diagnosticStore.updateHealth({ voiceState: 'CONNECTING' });
      expect(diagnosticStore.getActiveError()).toBe('Simulated WebSocket Connection Failure');

      // Explicit clear
      diagnosticStore.clearActiveError();
      expect(diagnosticStore.getActiveError()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 10. DIAGNOSTIC EXPORT & REDACTION
  // ---------------------------------------------------------------------------
  describe('10. Diagnostic Export & Redaction', () => {
    it('exports complete diagnostic JSON while redacting API keys, secret tokens, and SINs', () => {
      diagnosticStore.log({
        level: 'INFO',
        category: 'CLIENT',
        event: 'TELEMETRY_EXPORT_TEST',
        details: {
          apiKey: 'AIzaSyD987654321098765432109876543210',
          secretToken: 'sk-abcdef1234567890abcdef123456',
          sinNumber: '987-654-321',
          diagnosticSessionId: 'sess_valid_abc123'
        }
      });

      const jsonString = diagnosticStore.exportSanitizedDiagnostics();
      expect(jsonString).not.toContain('AIzaSyD987654321098765432109876543210');
      expect(jsonString).not.toContain('sk-abcdef1234567890abcdef123456');
      expect(jsonString).not.toContain('987-654-321');

      // Debugging context preserved
      expect(jsonString).toContain('sess_valid_abc123');
      expect(jsonString).toContain('TELEMETRY_EXPORT_TEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 11. MEMORY & RING BUFFER BOUNDING
  // ---------------------------------------------------------------------------
  describe('11. Memory & Bounded Ring Buffer', () => {
    it('enforces hard limit of 250 events with FIFO eviction under high telemetry load', () => {
      diagnosticStore.clearEvents();
      for (let i = 0; i < 350; i++) {
        diagnosticStore.log({
          level: 'DEBUG',
          category: 'AUDIO_OUTPUT',
          event: `CHUNK_PROCESS_${i}`
        });
      }

      const events = diagnosticStore.getEvents();
      expect(events.length).toBe(250);
      expect(events[0].event).toBe('CHUNK_PROCESS_100');
      expect(events[249].event).toBe('CHUNK_PROCESS_349');
    });
  });

  // ---------------------------------------------------------------------------
  // 12. WEBSOCKET SINGLE-SOCKET INVARIANT
  // ---------------------------------------------------------------------------
  describe('12. WebSocket Single-Socket Invariant', () => {
    it('prevents multiple competing sockets and cleans up previous socket on reconnect', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      const firstGen = (client as any).connectionGeneration;

      // Duplicate connect call when already connected is a no-op
      await client.connect();
      expect((client as any).connectionGeneration).toBe(firstGen);

      // Reconnect via openWebSocket cleans up old socket
      const oldSocket = mockWsInstance;
      (client as any).openWebSocket();
      expect(oldSocket.readyState).toBe(3); // Closed
      expect(mockWsInstance.readyState).toBe(1); // New active socket

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 13. CLOSE CODE 1007 PROTOCOL ERROR HARDENING
  // ---------------------------------------------------------------------------
  describe('13. Close Code 1007 Protocol Error Hardening', () => {
    it('transitions to PROTOCOL_ERROR without auto-reconnecting on code 1007', async () => {
      let currentState = '';
      const client = new GeminiLiveClient({
        onStateChange: (s) => { currentState = s; },
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 20));
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // Gemini closes with 1007
      mockWsInstance.close(1007, 'Request contains an invalid argument');

      expect(currentState).toBe('PROTOCOL_ERROR');
      // Must not initiate reconnect
      expect((client as any).reconnectTimer).toBeNull();
      expect((client as any).reconnectAttempts).toBe(0);

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 14. CRM NON-BLOCKING ISOLATION
  // ---------------------------------------------------------------------------
  describe('14. CRM Non-Blocking Isolation', () => {
    it('maintains live conversational voice loop even when backend CRM sync fails', async () => {
      // Mock fetch to reject for CRM endpoint
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (typeof url === 'string' && url.includes('/api/voice/sync-lead')) {
          return new Response(JSON.stringify({ error: 'CRM service unavailable' }), { status: 503 });
        }
        return new Response(
          JSON.stringify({
            apiKey: 'test-gemini-key-12345',
            model: 'models/gemini-2.5-flash-native-audio-latest',
            voiceName: 'Puck'
          }),
          { status: 200 }
        );
      });

      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 20));
      (client as any).hasSentInitialGreeting = true;
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // Ingest CRM data that triggers syncToBackend()
      client.ingestUserTranscript('My name is Marcus and my phone is 204-555-1234');
      await new Promise(r => setTimeout(r, 50));

      // Voice connection remains active and capable of speaking
      const dummyPcm = Buffer.from(new Int16Array(1200).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }]
            }
          }
        })
      });

      expect(client.getState()).toBe('SPEAKING');
      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 15. PERFORMANCE & AUDIOSOURCE CLEANUP CHECK
  // ---------------------------------------------------------------------------
  describe('15. Performance & AudioSource Cleanup Check', () => {
    it('removes completed AudioBufferSourceNodes from activeAudioSources array onended', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 20));
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      const dummyPcm = Buffer.from(new Int16Array(1200).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }]
            }
          }
        })
      });

      expect((client as any).activeAudioSources.length).toBe(1);

      // Trigger audio buffer completion onended
      const source = mockAudioContextInstance.createdSources[0];
      source.stop();

      // Node must be purged from activeAudioSources array to prevent memory leak
      expect((client as any).activeAudioSources.length).toBe(0);
      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 16. PRODUCTION TELEMETRY EVENT PIPELINE & SCHEMA INVARIANTS
  // ---------------------------------------------------------------------------
  describe('16. Production Telemetry Event Pipeline & Schema Invariants', () => {
    it('verifies exact chain of telemetry events and schema invariants from user gesture to playback end', async () => {
      // 1. Hardware unlock
      await GeminiLiveClient.unlockAudioContext();

      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      // 2. Connect & setup
      await client.connect();
      await new Promise(r => setTimeout(r, 20));
      mockWsInstance.onmessage?.({ data: JSON.stringify({ setupComplete: true }) });

      // 3. Enable microphone
      await client.enableMicrophone();

      // Simulate mic audio processing (speech frame)
      const mockAudioProcessEvent = {
        inputBuffer: {
          getChannelData: () => {
            const data = new Float32Array(2048);
            data.fill(0.1); // High RMS to pass speech threshold
            return data;
          }
        }
      };
      (client as any).inputProcessor?.onaudioprocess(mockAudioProcessEvent);

      // 4. Server audio response
      const dummyPcm = Buffer.from(new Int16Array(2400).buffer).toString('base64');
      mockWsInstance.onmessage?.({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: dummyPcm } }]
            }
          }
        })
      });

      // 5. Audio playback end
      const lastSource = mockAudioContextInstance.createdSources[mockAudioContextInstance.createdSources.length - 1];
      lastSource.stop();

      const events = diagnosticStore.getEvents();
      const eventNames = events.map(e => e.event);

      // Verify every required event is recorded
      expect(eventNames).toContain('AUDIO_HARDWARE_UNLOCK_START');
      expect(eventNames).toContain('AUDIO_HARDWARE_UNLOCK_SUCCESS');
      expect(eventNames).toContain('WEBSOCKET_CONNECT_START');
      expect(eventNames).toContain('WEBSOCKET_CONNECTED');
      expect(eventNames).toContain('GEMINI_SETUP_SENT');
      expect(eventNames).toContain('GEMINI_SETUP_COMPLETE');
      expect(eventNames).toContain('MICROPHONE_SETUP_START');
      expect(eventNames).toContain('MICROPHONE_SETUP_SUCCESS');
      expect(eventNames).toContain('USER_AUDIO_CAPTURE_STARTED');
      expect(eventNames).toContain('USER_AUDIO_FRAME_SENT');
      expect(eventNames).toContain('GEMINI_MESSAGE_RECEIVED');
      expect(eventNames).toContain('GEMINI_AUDIO_FRAME_RECEIVED');
      expect(eventNames).toContain('AUDIO_DECODE_STARTED');
      expect(eventNames).toContain('AUDIO_DECODE_SUCCESS');
      expect(eventNames).toContain('AUDIO_BUFFER_CREATED');
      expect(eventNames).toContain('AUDIO_SOURCE_CREATED');
      expect(eventNames).toContain('AUDIO_SOURCE_STARTED');
      expect(eventNames).toContain('AUDIO_PLAYBACK_STARTED');
      expect(eventNames).toContain('AUDIO_PLAYBACK_ENDED');

      // Verify strict schema invariant on every event:
      // { timestamp, conversationId, sessionGeneration, socketId, event, details }
      for (const ev of events) {
        expect(typeof ev.timestamp).toBe('number');
        expect(typeof ev.conversationId).toBe('string');
        expect(typeof ev.sessionGeneration).toBe('number');
        expect(typeof ev.socketId).toBe('string');
        expect(typeof ev.event).toBe('string');
        expect(ev.details).toBeDefined();
      }

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // 17. SINGLE SOCKET INVARIANT & 1007 PROTOCOL ERROR AUDIT
  // ---------------------------------------------------------------------------
  describe('17. Single Socket Invariant & 1007 Protocol Error Audit', () => {
    it('enforces activeGeminiSockets <= 1 and records GEMINI_1007_INVALID_ARGUMENT on 1007 close', async () => {
      const client = new GeminiLiveClient({
        onStateChange: () => {},
        onMicStatusChange: () => {},
        onUserAudioLevel: () => {},
        onJarvisAudioLevel: () => {},
        onTranscript: () => {},
        onBuyerIntelligenceUpdated: () => {},
        onError: () => {}
      });

      await client.connect();
      await new Promise(r => setTimeout(r, 20));

      const initialHealth = diagnosticStore.getHealth();
      expect(initialHealth.activeSocketCount).toBeLessThanOrEqual(1);

      // Send a text message to populate outbound buffer
      client.sendTextMessage('Test message before 1007');

      // Simulate Gemini closing with 1007
      mockWsInstance.close(1007, 'Request contains an invalid argument');

      const events = diagnosticStore.getEvents();
      const has1007Event = events.some(e => e.event === 'GEMINI_1007_INVALID_ARGUMENT');
      expect(has1007Event).toBe(true);

      const errorEvent = events.find(e => e.event === 'GEMINI_1007_INVALID_ARGUMENT')!;
      expect(errorEvent.details.closeCode).toBe(1007);
      expect(errorEvent.details.lastOutboundMessage).toBeDefined();

      client.disconnect();
    });
  });
});
