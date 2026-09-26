import { VoiceConversationEngine } from './VoiceConversationEngine';
import { SalesOrchestrator } from '../salesDesk/salesOrchestrator';
import { SessionContextManager } from './SessionIdentity';
import { WebAudioEngine } from './audio/WebAudioEngine';

export type SessionLifecycleState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'ACTIVE'
  | 'BACKGROUND'
  | 'SUSPENDED'
  | 'RECONNECTING'
  | 'ENDING'
  | 'TERMINATED'
  | 'FAILED';

export interface TransitionContext {
  from: SessionLifecycleState;
  to: SessionLifecycleState;
  reason: string;
  traceId?: string;
  generation?: number;
}

export class SessionController {
  public contextManager: SessionContextManager;
  public voiceEngine: VoiceConversationEngine;
  public orchestrator: SalesOrchestrator;
  
  private abortController: AbortController;
  private currentState: SessionLifecycleState = 'IDLE';
  
  private idleTimerGeneration = 0;
  private idleTimer: any = null;
  
  // Expose this for telemetry bounds checks
  public mediaGeneration = 0;

  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    this.contextManager = new SessionContextManager();
    this.abortController = new AbortController();
    this.orchestrator = new SalesOrchestrator('classic');
    
    // Voice conversation engine instance attached to this session
    this.voiceEngine = VoiceConversationEngine.getInstance();
    this.voiceEngine.setOrchestrator(this.orchestrator);

    this.setupVisibilityListeners();
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const res = await fetch('/api/session/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error(`Session init failed: HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.ok && data.conversationId) {
          this.setSessionId(data.conversationId);
          if (Array.isArray(data.history) && data.history.length > 0) {
            this.orchestrator.setHistory(data.history);
          }
        }
        this.isInitialized = true;
      } catch (err) {
        console.error('[SessionController] Failed to initialize session:', err);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public setSessionId(id: string) {
    this.orchestrator.setSessionId(id);
    this.voiceEngine.sessionId = id;
  }

  public async activateVoice(callbacks?: any, speakGreeting = true): Promise<void> {
    this.orchestrator.switchMode('voice', 'user_explicit_gesture');
    await this.voiceEngine.start(callbacks, speakGreeting);
  }

  public async deactivateVoice(): Promise<void> {
    this.orchestrator.switchMode('classic', 'user_explicit_gesture');
    await this.voiceEngine.stop();
  }

  public getSessionId(): string {
    return this.orchestrator.getState().sessionId || this.contextManager.getSessionId();
  }
  
  public getState(): SessionLifecycleState {
    return this.currentState;
  }

  public getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }
  
  public resetIdleTimer(activityType: string) {
    if (this.currentState === 'ENDING' || this.currentState === 'TERMINATED' || this.currentState === 'FAILED') return;
    
    this.idleTimerGeneration++;
    const currentGeneration = this.idleTimerGeneration;
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    
    // 5-minute idle timeout
    this.idleTimer = setTimeout(() => {
      if (this.idleTimerGeneration !== currentGeneration) {
        return; // Stale timer
      }
      if (this.currentState !== 'ACTIVE' && this.currentState !== 'IDLE') {
         this.transition({
           from: this.currentState,
           to: 'ENDING',
           reason: 'IDLE_TIMEOUT_FIRED'
         });
      }
    }, 5 * 60 * 1000);
  }

  public transition(ctx: TransitionContext) {
    if (this.currentState !== ctx.from) {
      console.warn(`[SessionController] Rejecting illegal transition: ${ctx.from} -> ${ctx.to}. Current state is ${this.currentState}`);
      return;
    }
    
    // Explicit guards
    if (this.currentState === 'TERMINATED' || this.currentState === 'FAILED') {
      if (ctx.to === 'ACTIVE' || ctx.to === 'INITIALIZING') {
         console.warn(`[SessionController] Blocked transition from terminal state ${this.currentState} to ${ctx.to}`);
         return;
      }
    }
    
    if (this.currentState === 'ENDING' && ctx.to === 'ACTIVE') {
      console.warn(`[SessionController] Blocked implicit transition from ENDING to ACTIVE.`);
      return;
    }

    console.log(`[SessionController] Transitioning ${this.currentState} -> ${ctx.to} (${ctx.reason})`);
    this.currentState = ctx.to;
    
    this.handleStateEntry(ctx.to);
  }
  
  private handleStateEntry(state: SessionLifecycleState) {
    switch (state) {
      case 'ACTIVE':
        this.resetIdleTimer('entered_active');
        break;
      case 'SUSPENDED':
        WebAudioEngine.getInstance().getAudioContext()?.suspend();
        break;
      case 'RECONNECTING':
        this.mediaGeneration++; // Invalidate old audio callbacks
        WebAudioEngine.getInstance().getAudioContext()?.resume();
        this.transition({ from: 'RECONNECTING', to: 'ACTIVE', reason: 'RESUMED' });
        break;
      case 'ENDING':
        this.terminate('CLEAN_SHUTDOWN');
        break;
      case 'FAILED':
        this.terminate('FATAL_ERROR');
        break;
    }
  }

  public async start(): Promise<void> {
    this.transition({ from: 'IDLE', to: 'INITIALIZING', reason: 'START_REQUESTED' });
    try {
      await this.voiceEngine.start();
      this.transition({ from: 'INITIALIZING', to: 'ACTIVE', reason: 'ENGINE_STARTED' });
    } catch (err: any) {
      console.error('[SessionController] voiceEngine.start failed:', err);
      this.transition({ from: 'INITIALIZING', to: 'FAILED', reason: err?.message || 'START_FAILED' });
    }
  }

  private setupVisibilityListeners() {
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
          if (this.currentState === 'ACTIVE') {
            this.transition({ from: 'ACTIVE', to: 'BACKGROUND', reason: 'TAB_HIDDEN' });
            // Only suspend if audio context is actually suspended or closed
            const audioCtx = WebAudioEngine.getInstance().getAudioContext();
            if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'closed')) {
              this.transition({ from: 'BACKGROUND', to: 'SUSPENDED', reason: 'AUDIO_SUSPENDED' });
            }
          }
        } else {
          if (this.currentState === 'SUSPENDED') {
            this.transition({ from: 'SUSPENDED', to: 'RECONNECTING', reason: 'TAB_VISIBLE' });
          } else if (this.currentState === 'BACKGROUND') {
            this.transition({ from: 'BACKGROUND', to: 'ACTIVE', reason: 'TAB_VISIBLE' });
          }
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private removeVisibilityListeners() {
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  public terminate(reason = 'EXPLICIT_SESSION_END') {
    if (this.currentState === 'TERMINATED') return;
    
    this.currentState = 'TERMINATED';
    this.abortController.abort();
    this.contextManager.incrementSessionGeneration();
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.removeVisibilityListeners();
    
    this.voiceEngine.stop().catch(err => {
      console.warn('[SessionController] voiceEngine.stop error during terminate:', err);
    });
  }
}

let activeSession: SessionController | null = null;

export function getActiveSession(): SessionController {
  if (!activeSession || activeSession.getState() === 'TERMINATED' || activeSession.getState() === 'FAILED') {
    activeSession = new SessionController();
  }
  return activeSession;
}

export function terminateActiveSession() {
  if (activeSession) {
    activeSession.terminate();
    activeSession = null;
  }
}
