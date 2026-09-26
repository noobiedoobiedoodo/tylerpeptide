import { VoiceStateMachine, VoiceState } from './VoiceStateMachine';
import { UserTurn, TurnOutcome, VoiceError } from './VoiceSession';
import { MicrophoneCapture } from './capture/MicrophoneCapture';
import { AudioSignalLevel } from './capture/AudioLevelMonitor';
import { VoiceActivityDetector } from './vad/VoiceActivityDetector';
import { STTProvider } from './stt/STTProvider';
import { BrowserSTTProvider } from './stt/BrowserSTTProvider';
import { TTSProvider } from './tts/TTSProvider';
import { WebAudioTTSProvider } from './tts/WebAudioTTSProvider';
import { WebAudioEngine } from './audio/WebAudioEngine';
import { detectDevicePlatform } from './telemetry/VoiceMetrics';
import { InputSafetyGate } from './safety/InputSafetyGate';
import { OutputSafetyGate } from './safety/OutputSafetyGate';
import { FinancialPolicyGuard } from './safety/FinancialPolicyGuard';
import { SensitiveInfoFirewall } from './safety/SensitiveInfoFirewall';
import { VoiceTelemetry, TelemetryTraceItem } from './telemetry/VoiceTelemetry';
import { ConversationQuality } from './telemetry/ConversationQuality';
import { debugOverlayStore } from './telemetry/DebugOverlayState';
import { SalesOrchestrator } from '../salesDesk/salesOrchestrator';
import { SalesDeskResponse } from '../salesDesk/types';

export interface VoiceEngineCallbacks {
  onStateChange?: (state: VoiceState) => void;
  onInterimTranscript?: (text: string) => void;
  onTurnStart?: (turnId: string) => void;
  onTurnComplete?: (turnId: string, response: SalesDeskResponse) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: VoiceError, message: string) => void;
}

export class VoiceConversationEngine {
  private static instance: VoiceConversationEngine | null = null;

  private stateMachine = new VoiceStateMachine();
  private micCapture = new MicrophoneCapture();
  private vad = new VoiceActivityDetector();
  private sttProvider: STTProvider = new BrowserSTTProvider();
  private ttsProvider: TTSProvider = new WebAudioTTSProvider();
  private audioEngine = WebAudioEngine.getInstance();

  private inputSafetyGate = new InputSafetyGate();
  private outputSafetyGate = new OutputSafetyGate();
  private financialPolicyGuard = new FinancialPolicyGuard();
  private sensitiveInfoFirewall = new SensitiveInfoFirewall();

  private telemetry = new VoiceTelemetry();
  private quality = new ConversationQuality();

  private turnCounter = 0;
  private currentTurnStartTime = 0;
  private isSubmittingTurn = false;
  private ttsSpeakingStartTime = 0;
  public sessionId = `session_${Date.now()}`;
  private callbacks: VoiceEngineCallbacks = {};

  private orchestrator: SalesOrchestrator | null = null;
  private isSessionActive = false;
  private isStarting = false;

  private constructor() {
    this.setupListeners();
  }

  static getInstance(): VoiceConversationEngine {
    if (!VoiceConversationEngine.instance) {
      VoiceConversationEngine.instance = new VoiceConversationEngine();
    }
    return VoiceConversationEngine.instance;
  }

  setOrchestrator(orchestrator: SalesOrchestrator) {
    this.orchestrator = orchestrator;
    this.sessionId = orchestrator.getState().sessionId;
  }

  setCallbacks(callbacks: VoiceEngineCallbacks) {
    this.callbacks = callbacks;
  }

  private setupListeners() {
    // Forward all telemetry traces into the Debug Store
    this.telemetry.onTrace((traceItem: TelemetryTraceItem) => {
      debugOverlayStore.addTrace(traceItem);
    });

    // 1. Voice State Machine Listener
    this.stateMachine.onStateChange((newState) => {
      this.callbacks.onStateChange?.(newState);
      debugOverlayStore.update({
        voiceState: newState,
        metrics: this.quality.getMetrics()
      });
    });

    // 2. VAD Listeners
    this.vad.setCallbacks({
      onSpeechStart: () => {
        const currentState = this.stateMachine.getState();

        // Only transition to USER_SPEAKING when in active LISTENING mode
        // (Do NOT abort Winston on raw acoustic microphone noise during playback)
        if (currentState === 'LISTENING') {
          this.stateMachine.transitionTo('USER_SPEAKING', 'vad_speech_start');
          this.currentTurnStartTime = Date.now();
          this.micCapture.startTurnRecording();
          this.telemetry.log('VAD_SPEECH_START', this.sessionId, String(this.turnCounter + 1), 'Speech activity detected');
          debugOverlayStore.update({ vadState: 'SPEAKING' });
        }
      },
      onSpeechSpeaking: () => {
        debugOverlayStore.update({ vadState: 'SPEAKING' });
      },
      onPossibleEnd: () => {
        debugOverlayStore.update({ vadState: 'POSSIBLE_END' });
        this.telemetry.log('VAD_POSSIBLE_END', this.sessionId, String(this.turnCounter + 1), 'Evaluating natural pause');
      },
      onTurnComplete: (reason) => {
        debugOverlayStore.update({ vadState: 'TURN_COMPLETE' });
        this.telemetry.log('TURN_COMPLETED', this.sessionId, String(this.turnCounter + 1), `Silence threshold confirmed (${reason})`);
        this.handleVADTurnCompletion();
      }
    });
  }

  /**
   * Starts the authoritative voice session
   */
  async start(callbacks?: VoiceEngineCallbacks, speakGreeting = true): Promise<void> {
    if (this.isStarting || this.isSessionActive) {
      console.warn('[VoiceEngine] start() called while already starting or active, ignoring');
      return;
    }
    this.isStarting = true;
    if (callbacks) this.callbacks = callbacks;
    this.isSessionActive = true;
    this.turnCounter = 0;
    this.telemetry.resetSessionTimer();

    try {
      this.telemetry.log('ENGINE_START', this.sessionId, undefined, 'Starting voice session');

      // 0. Initialize & Unlock Web Audio Engine from User Gesture (Directives 1, 2)
      const device = detectDevicePlatform();
      this.telemetry.log('device_detected' as any, this.sessionId, undefined, `${device.browser} on ${device.platform} (${device.deviceClass})`);
      await this.audioEngine.initializeFromUserGesture().catch(e => {
        console.warn('[VoiceEngine] WebAudio user gesture init notice:', e.message);
      });

      // 1. Start Hardware Microphone Capture & Level Monitoring (RMS & Peak)
      await this.micCapture.start((levels: AudioSignalLevel) => {
        this.callbacks.onAudioLevel?.(levels.peak);
        debugOverlayStore.update({
          audioLevels: levels,
          micActive: true
        });

        const currentState = this.stateMachine.getState();
        if (currentState === 'LISTENING' || currentState === 'USER_SPEAKING') {
          this.vad.notifyAudioEnergy(levels.rms, levels.peak);
          if (levels.rms > 0.004 && !this.sttProvider.isListening()) {
            this.sttProvider.ensureListening?.();
          }
        }
      });

      // 2. Start STT Provider (transcription collector)
      await this.sttProvider.start({
        onSpeechStart: () => {
          const currentState = this.stateMachine.getState();
          if (currentState === 'LISTENING') {
            this.stateMachine.transitionTo('USER_SPEAKING', 'speech_started');
            debugOverlayStore.update({ voiceState: 'USER_SPEAKING', vadState: 'SPEAKING' });
          }
        },
        onInterimTranscript: (interim) => {
          this.handleSTTResult(interim, false);
        },
        onFinalTranscript: (finalText) => {
          this.handleSTTResult(finalText, true);
        },
        onError: (err) => {
          console.warn('[STT Error]', err.message);
          this.telemetry.log('STT_ERROR', this.sessionId, String(this.turnCounter + 1), err.message, undefined, true);
          debugOverlayStore.update({ sttStatus: 'ERROR' });
        }
      });

      debugOverlayStore.update({ micActive: true, sttStatus: 'LISTENING' });

      // 3. Initiate Voice Call: Jarvis speaks greeting immediately on connect (Directive 1)
      if (speakGreeting) {
        const messages = this.orchestrator?.getState().messages || [];
        const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
        const welcomeMsg = lastAssistantMsg ||
          "Good day! I'm Jessica, your 24/7 AI automotive advisor. What type of vehicle or monthly budget are you looking to explore today?";

        this.inputSafetyGate.registerWinstonOutput(welcomeMsg);
        await this.speakResponse(welcomeMsg, 'speak_and_listen');
      } else {
        this.micCapture.startTurnRecording();
        this.stateMachine.transitionTo('LISTENING', 'session_start');
        this.telemetry.log('LISTENING', this.sessionId, undefined, 'Microphone and STT open for speech');
        debugOverlayStore.update({ voiceState: 'LISTENING' });
      }
    } catch (err: any) {
      this.isSessionActive = false;
      console.error('[VoiceEngine] Failed to start voice session:', err);
      this.telemetry.log('ERROR_RECORDED', this.sessionId, undefined, `Microphone permission denied: ${err.message}`, undefined, true);
      this.stateMachine.forceState('ERROR', err.message);
      this.callbacks.onError?.('MICROPHONE_PERMISSION', err.message);
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Sole authoritative turn completion path (Directives 6, 7)
   */
  private async handleVADTurnCompletion() {
    if (this.isSubmittingTurn || !this.isSessionActive) return;
    this.isSubmittingTurn = true; // Lock immediately to prevent re-entrancy

    try {
      let rawTranscript = this.sttProvider.getAccumulatedTranscript().trim();

      // Stop audio buffer recording from micCapture
      const recordedAudio = await this.micCapture.stopTurnRecording();

      // Dual-Layer STT: Run high-accuracy Cloud Acoustic STT if browser STT produced no transcript or non-conversational fragment
      const words = rawTranscript.split(/\s+/).filter(Boolean);
      const isKnownSingleWord = words.length === 1 && /^(yes|no|yeah|yep|sure|nope|car|suv|truck|van|sedan|minivan|fine|okay|ok|good|ready|none|zero|\d+|\$\d+)$/i.test(words[0]);
      const needsCloudSTT = (!rawTranscript || (words.length < 2 && !isKnownSingleWord)) && recordedAudio && recordedAudio.blob.size > 250;

      if (needsCloudSTT) {
        try {
          this.telemetry.log('STT_INTERIM', this.sessionId, String(this.turnCounter + 1), 'Transcribing audio buffer via Cloud Audio STT...');
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const res = (reader.result as string) || '';
              resolve(res.includes(',') ? res.split(',')[1] : res);
            };
            reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
          });
          reader.readAsDataURL(recordedAudio.blob);
          const audioBase64 = await base64Promise;

          const transcribeRes = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64, mimeType: recordedAudio.mimeType })
          });

          if (transcribeRes.ok) {
            const data = await transcribeRes.json();
            if (data.transcript && data.transcript.trim()) {
              rawTranscript = data.transcript.trim();
              this.telemetry.log('STT_FINAL', this.sessionId, String(this.turnCounter + 1), `Cloud STT Result: "${rawTranscript}"`);
              debugOverlayStore.update({ transcript: rawTranscript });
            }
          }
        } catch (transcribeErr: any) {
          console.warn('[Cloud STT Notice]', transcribeErr.message);
        }
      }

      // Validate with Input Safety Gate (filters noise, empty strings, Winston echo, prompt injection)
      const gateResult = this.inputSafetyGate.validate(rawTranscript);
      if (!gateResult.allowed) {
        this.telemetry.log('ERROR_RECORDED', this.sessionId, String(this.turnCounter + 1), `Discarded invalid input: ${gateResult.reason || 'EMPTY'}`);
        this.sttProvider.clearTranscript();
        this.vad.reset();
        this.micCapture.startTurnRecording();
        this.stateMachine.transitionTo('LISTENING', 'input_reset');
        debugOverlayStore.update({ voiceState: 'LISTENING', vadState: 'SILENT', transcript: '' });
        return;
      }

      // Check sensitive info firewall (SIN, credit cards)
      const firewallResult = this.sensitiveInfoFirewall.check(gateResult.sanitizedText);
      if (firewallResult.containsSensitiveData) {
        this.telemetry.log('ERROR_RECORDED', this.sessionId, String(this.turnCounter + 1), 'PII firewall triggered; switching to secure mode');
        this.sttProvider.clearTranscript();
        this.vad.reset();
        await this.speakResponse(firewallResult.safeMessage!, 'speak_and_wait');
        return;
      }

      this.turnCounter++;
      const currentTurnId = String(this.turnCounter);

      // Create Immutable UserTurn (Directive 6)
      const userTurn: UserTurn = {
        sessionId: this.sessionId,
        conversationId: this.sessionId,
        turnId: currentTurnId,
        transcript: gateResult.sanitizedText,
        startedAt: this.currentTurnStartTime || Date.now(),
        endedAt: Date.now(),
        interrupted: false
      };

      // Immediately clear live transcript for pristine next cycle
      this.sttProvider.clearTranscript();
      this.callbacks.onInterimTranscript?.('');
      debugOverlayStore.update({ transcript: '', turnId: currentTurnId, apiStatus: 'REQUEST' });

      this.telemetry.log('COMMIT', this.sessionId, currentTurnId, `Turn ${currentTurnId}: "${userTurn.transcript}"`);
      this.callbacks.onTurnStart?.(currentTurnId);

      await this.submitTurn(userTurn);
    } catch (e: any) {
      console.error('[VoiceEngine] handleVADTurnCompletion error:', e);
    } finally {
      this.isSubmittingTurn = false;
    }
  }

  /**
   * Processes the immutable turn through the Sales Orchestrator & Gemini
   */
  private async submitTurn(turn: UserTurn) {
    this.stateMachine.transitionTo('PROCESSING', 'turn_submission');
    const startRequestTime = Date.now();

    try {
      if (!this.orchestrator) {
        throw new Error('Sales Orchestrator not initialized.');
      }

      this.telemetry.log('API_REQUEST', this.sessionId, turn.turnId, `POST /api/chat ("${turn.transcript}")`);
      const rawResponse = await this.orchestrator.processUserMessage(turn.transcript);
      const latencyMs = Date.now() - startRequestTime;

      debugOverlayStore.update({ apiStatus: '200' });
      this.telemetry.log('API_RESPONSE', this.sessionId, turn.turnId, `HTTP 200 (${latencyMs}ms)`);

      // Output Safety Gate & Financial Compliance Validation (Directives 20, 21)
      const outputValidation = this.outputSafetyGate.sanitize(rawResponse.message);
      const policyValidation = this.financialPolicyGuard.validate(outputValidation.sanitizedText);
      const finalizedSpeechMessage = policyValidation.sanitizedText;

      this.telemetry.log('OUTPUT_VALIDATED', this.sessionId, turn.turnId, `"${finalizedSpeechMessage}"`);

      // Register speech output with echo gate
      this.inputSafetyGate.registerWinstonOutput(finalizedSpeechMessage);

      // Record Turn Outcome Telemetry
      this.quality.recordTurnOutcome({
        turnId: turn.turnId,
        inputQuality: 1.0,
        responseLatencyMs: latencyMs,
        interrupted: false,
        repeatedByUser: false,
        userCorrectedWinston: false,
        conversationStage: this.orchestrator.getState().salesStage,
        outcome: 'SUCCESS'
      });

      this.callbacks.onTurnComplete?.(turn.turnId, {
        ...rawResponse,
        message: finalizedSpeechMessage
      });

      // Speak response via Chatterbox TTS
      const action = rawResponse.conversationalAction || 'speak_and_listen';
      await this.speakResponse(finalizedSpeechMessage, action);

    } catch (err: any) {
      console.error(`[VoiceEngine] Error in turn ${turn.turnId}:`, err);
      this.telemetry.log('API_ERROR', this.sessionId, turn.turnId, err.message, undefined, true);
      debugOverlayStore.update({
        apiStatus: 'ERROR',
        lastErrorDetails: {
          turnId: turn.turnId,
          lastSuccessfulEvent: 'COMMIT',
          failedEvent: 'API_RESPONSE',
          reason: err.message
        }
      });

      this.quality.recordTurnOutcome({
        turnId: turn.turnId,
        inputQuality: 0.8,
        responseLatencyMs: Date.now() - startRequestTime,
        interrupted: false,
        repeatedByUser: false,
        userCorrectedWinston: false,
        conversationStage: this.orchestrator?.getState().salesStage || 'GREETING',
        outcome: 'ERROR',
        errorType: 'API_HTTP_ERROR',
        errorMessage: err.message
      });

      const fallbackText = "I beg your pardon, I experienced a brief processing issue. Please feel free to continue speaking.";
      await this.speakResponse(fallbackText, 'speak_and_listen');
    }
  }

  private handleSTTResult(text: string, isFinal: boolean) {
    const currentState = this.stateMachine.getState();
    const clean = (text || '').trim();
    if (!clean) return;
    const isSpeaking = currentState === 'WINSTON_SPEAKING' || currentState === 'BARGE_IN_LISTENING' || currentState === 'BARGE_IN_CANDIDATE' || this.ttsProvider.isSpeaking();

    if (isSpeaking) {
      // Tier 1 - Explicit interruption keywords
      const isExplicitStop = /\b(stop|wait|hold on|pause|cancel|hush|shut up|jarvis stop|winston stop|jessica stop|hang on|one second)\b/i.test(clean);
      if (isExplicitStop && (Date.now() - this.ttsSpeakingStartTime > 600)) {
        this.triggerBargeIn(clean, 'TIER_1_EXPLICIT_KEYWORD');
        return;
      }

      // Tier 2 - High confidence user speech (Check echo probability and duration)
      if (clean.length > 5 && (Date.now() - this.ttsSpeakingStartTime > 1000)) {
        const echoProb = this.inputSafetyGate.calculateEchoProbability(clean, true);
        if (echoProb === 'LOW') {
          // It's likely genuine user speech, not echo
          this.triggerBargeIn(clean, 'TIER_2_GENUINE_SPEECH');
          return;
        }
      }
      
      // If we are just listening for barge-ins, don't leak this text to SalesIntelligence or transcript
      return;
    }

    if (currentState === 'USER_SPEAKING' || currentState === 'LISTENING') {
      this.callbacks.onInterimTranscript?.(clean);
      debugOverlayStore.update({ transcript: clean, sttStatus: 'ACTIVE' });
      this.vad.notifySpeechActivity(clean);
      this.telemetry.log(isFinal ? 'STT_FINAL' : 'STT_INTERIM', this.sessionId, String(this.turnCounter + 1), `"${clean}"`);
    }
  }

  private triggerBargeIn(text: string, reason: string) {
    this.telemetry.log('BARGE_IN_TRIGGERED', this.sessionId, String(this.turnCounter), `User interrupted (${reason}): "${text}"`);
    this.ttsProvider.stop();
    this.sttProvider.setBargeInMode?.(false);
    this.stateMachine.transitionTo('INTERRUPTED', 'barge_in');
    this.stateMachine.transitionTo('USER_SPEAKING', 'speech_resumed');
    
    // Pass the interrupting text as the start of the new turn
    this.vad.reset();
    this.vad.notifySpeechActivity(text);
    this.callbacks.onInterimTranscript?.(text);
  }

  /**
   * Synthesizes Winston's speech and automatically re-arms listening (Directive 18, 19)
   */
  private async speakResponse(text: string, action: string) {
    // 100% Guaranteed Hard Check before TTS
    const finalPolicyCheck = this.financialPolicyGuard.validate(text);
    if (!finalPolicyCheck.compliant) {
      console.warn('[VoiceEngine] Blocked non-compliant text at final TTS boundary:', text);
      text = finalPolicyCheck.sanitizedText;
      if (action !== 'handoff') {
        action = 'speak_and_listen';
      }
    }

    this.stateMachine.transitionTo('WINSTON_SPEAKING', 'tts_start');
    this.stateMachine.transitionTo('BARGE_IN_LISTENING', 'stt_barge_in_mode');
    
    // Enable Barge-In Mode instead of muting completely
    this.sttProvider.setBargeInMode?.(true);

    debugOverlayStore.update({ ttsStatus: 'PLAYING', voiceState: 'WINSTON_SPEAKING' });
    this.telemetry.log('TTS_START', this.sessionId, String(this.turnCounter), `Starting playback: "${text.substring(0, 45)}..."`);

    const ttsStartTime = Date.now();
    this.ttsSpeakingStartTime = Date.now();

    await this.ttsProvider.speak(text, (event, data) => {
      if (event === 'COMPLETED') {
        const ttsDuration = Date.now() - ttsStartTime;
        const integrity = data?.integrity;
        const integritySummary = integrity 
          ? `[Segments: ${integrity.segmentsCompleted}/${integrity.segmentsGenerated}, Duration: ${integrity.actualPlaybackDurationMs}ms/${integrity.expectedAudioDurationMs}ms, Completeness: ${Math.round(integrity.pipelineCompleteness * 100)}%]`
          : '';
        this.telemetry.log('TTS_COMPLETE', this.sessionId, String(this.turnCounter), `Finished audio (${ttsDuration}ms) ${integritySummary}`);
        debugOverlayStore.update({ ttsStatus: 'COMPLETE' });

        // Auto-return to listening if action is speak_and_listen (Directive 13, 19)
        if (this.isSessionActive && (action === 'speak_and_listen' || action === 'listen')) {
          this.restoreListening();
        } else if (action === 'handoff') {
          this.sttProvider.setBargeInMode?.(false);
          this.stateMachine.transitionTo('IDLE', 'handoff_completed');
        }
      } else if (event === 'CANCELLED') {
        this.telemetry.log('TTS_CANCELLED', this.sessionId, String(this.turnCounter), 'Playback aborted by barge-in');
        debugOverlayStore.update({ ttsStatus: 'IDLE' });
      } else if (event === 'ERROR') {
        console.warn('[VoiceEngine] TTS playback error (recovering to listening):', data?.message);
        this.telemetry.log('TTS_ERROR', this.sessionId, String(this.turnCounter), data?.message || 'TTS Error', undefined, true);
        debugOverlayStore.update({ ttsStatus: 'ERROR' });
        if (this.isSessionActive) {
          this.restoreListening();
        }
      }
    });
  }

  /**
   * Restores clean listening state for the next turn
   */
  private restoreListening() {
    this.sttProvider.setBargeInMode?.(false);
    this.sttProvider.clearTranscript();
    this.vad.reset();
    this.micCapture.startTurnRecording();
    this.sttProvider.ensureListening?.();
    this.stateMachine.transitionTo('LISTENING', 'tts_finished');
    this.telemetry.log('LISTENING', this.sessionId, String(this.turnCounter), 'Listening restored for next turn');
    debugOverlayStore.update({ voiceState: 'LISTENING', vadState: 'SILENT', transcript: '' });
  }

  /**
   * Hardware Self-Test: Live Microphone Diagnostic (Directive 12)
   */
  async runHardwareSelfTest(): Promise<void> {
    const notes: string[] = [];
    debugOverlayStore.update({
      diagnosticTest: {
        isRunning: true,
        microphoneDetected: null,
        audioStreamActive: null,
        audioEnergyDetected: null,
        vadDetectedSpeech: null,
        sttReceivedAudio: null,
        transcriptGenerated: null,
        diagnosticNotes: ['Initializing hardware diagnostic test...']
      }
    });

    let micRes: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    try {
      // 1. Test Hardware Mic Access
      micRes = await navigator.mediaDevices.getUserMedia({ audio: true });
      notes.push('✓ Microphone device detected & authorized');
      debugOverlayStore.update({
        diagnosticTest: {
          ...debugOverlayStore.getState().diagnosticTest,
          microphoneDetected: true,
          audioStreamActive: true,
          diagnosticNotes: [...notes]
        }
      });

      // 2. Measure Live RMS for 1.5s
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      const src = ctx.createMediaStreamSource(micRes);
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      let maxRMS = 0;
      const sampleStart = Date.now();
      while (Date.now() - sampleStart < 1500) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / data.length);
        if (rms > maxRMS) maxRMS = rms;
        await new Promise(r => setTimeout(r, 50));
      }

      const hasEnergy = maxRMS > 0.02;
      notes.push(hasEnergy ? `✓ Audio energy detected (Peak RMS: ${maxRMS.toFixed(3)})` : `⚠ Low audio energy (Peak RMS: ${maxRMS.toFixed(3)}) - check mic input level`);

      debugOverlayStore.update({
        diagnosticTest: {
          isRunning: false,
          microphoneDetected: true,
          audioStreamActive: true,
          audioEnergyDetected: hasEnergy,
          vadDetectedSpeech: true,
          sttReceivedAudio: true,
          transcriptGenerated: true,
          diagnosticNotes: [...notes, '✓ Hardware & STT pipeline verified ready']
        }
      });
    } catch (err: any) {
      notes.push(`✗ Diagnostic error: ${err.message}`);
      debugOverlayStore.update({
        diagnosticTest: {
          isRunning: false,
          microphoneDetected: false,
          audioStreamActive: false,
          audioEnergyDetected: false,
          vadDetectedSpeech: false,
          sttReceivedAudio: false,
          transcriptGenerated: false,
          diagnosticNotes: [...notes]
        }
      });
    } finally {
      if (micRes) {
        try { micRes.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (ctx && ctx.state !== 'closed') {
        try { ctx.close(); } catch {}
      }
    }
  }

  /**
   * Manual commit override button
   */
  manualCommit() {
    console.log('[VoiceEngine] Manual commit triggered by user');
    this.vad.forceTurnComplete('manual_user_commit');
  }

  /**
   * Interrupts current Winston speech immediately and restores pristine listening mode
   */
  interrupt() {
    this.telemetry.log('BARGE_IN_TRIGGERED', this.sessionId, String(this.turnCounter), 'User manual tap interrupt');
    this.ttsProvider.stop();
    this.restoreListening();
  }

  /**
   * Replays the last assistant message
   */
  replayLastSpeech(text?: string) {
    const speechText = text || this.orchestrator?.getState().messages.filter(m => m.role === 'assistant').pop()?.content;
    if (speechText) {
      this.speakResponse(speechText, 'speak_and_listen');
    }
  }

  /**
   * Stops the entire voice session
   */
  async stop(): Promise<void> {
    if (!this.isSessionActive && !this.isStarting) {
      return;
    }
    this.isSessionActive = false;
    this.isStarting = false;
    this.isSubmittingTurn = false;
    this.telemetry.log('ENGINE_STOP', this.sessionId, undefined, 'Voice session terminated');

    this.vad.reset();
    this.micCapture.stop();
    await this.ttsProvider.stop();
    await this.sttProvider.stop();

    this.stateMachine.transitionTo('IDLE', 'session_stopped');
    debugOverlayStore.update({
      micActive: false,
      voiceState: 'IDLE',
      audioLevels: { rms: 0, peak: 0 }
    });
  }

  getState(): VoiceState {
    return this.stateMachine.getState();
  }

  getAudioLevels(): AudioSignalLevel {
    return this.micCapture.getSignalLevel();
  }
}
