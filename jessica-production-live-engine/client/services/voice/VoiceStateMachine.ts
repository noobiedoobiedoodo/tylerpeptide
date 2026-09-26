/**
 * VoiceStateMachine - Authoritative Voice State Machine
 * 
 * Enforces strict, deterministic voice state transitions:
 * IDLE -> LISTENING -> USER_SPEAKING -> PROCESSING -> WINSTON_SPEAKING -> LISTENING
 * Handles INTERRUPTED (barge-in) and ERROR states gracefully.
 */

export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'BARGE_IN_LISTENING' // Winston is speaking, listening for explicit barge-ins
  | 'BARGE_IN_CANDIDATE' // Potential speech detected, verifying confidence
  | 'USER_SPEAKING'
  | 'PROCESSING'
  | 'WINSTON_SPEAKING'
  | 'INTERRUPTED'
  | 'MUTED'
  | 'ERROR';

type StateChangeListener = (newState: VoiceState, oldState: VoiceState, reason?: string) => void;

const ALLOWED_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  IDLE: ['LISTENING', 'WINSTON_SPEAKING', 'USER_SPEAKING', 'ERROR', 'MUTED'],
  LISTENING: ['USER_SPEAKING', 'IDLE', 'ERROR', 'PROCESSING', 'WINSTON_SPEAKING', 'MUTED'],
  BARGE_IN_LISTENING: ['BARGE_IN_CANDIDATE', 'INTERRUPTED', 'IDLE', 'LISTENING', 'ERROR'],
  BARGE_IN_CANDIDATE: ['INTERRUPTED', 'BARGE_IN_LISTENING', 'LISTENING', 'IDLE', 'ERROR'],
  USER_SPEAKING: ['PROCESSING', 'LISTENING', 'WINSTON_SPEAKING', 'IDLE', 'ERROR', 'MUTED'],
  PROCESSING: ['WINSTON_SPEAKING', 'LISTENING', 'IDLE', 'ERROR', 'MUTED'],
  WINSTON_SPEAKING: ['BARGE_IN_LISTENING', 'INTERRUPTED', 'USER_SPEAKING', 'LISTENING', 'IDLE', 'ERROR', 'MUTED'],
  INTERRUPTED: ['USER_SPEAKING', 'LISTENING', 'PROCESSING', 'WINSTON_SPEAKING', 'IDLE', 'ERROR'],
  MUTED: ['LISTENING', 'IDLE', 'ERROR'],
  ERROR: ['IDLE', 'LISTENING', 'MUTED']
};

export class VoiceStateMachine {
  private currentState: VoiceState = 'IDLE';
  private listeners: StateChangeListener[] = [];

  getState(): VoiceState {
    return this.currentState;
  }

  canTransitionTo(targetState: VoiceState): boolean {
    if (this.currentState === targetState) return true;
    const allowed = ALLOWED_TRANSITIONS[this.currentState] || [];
    return allowed.includes(targetState);
  }

  transitionTo(targetState: VoiceState, reason?: string): boolean {
    if (this.currentState === targetState) {
      return true; // No-op idempotent
    }

    if (!this.canTransitionTo(targetState)) {
      console.warn(`[VoiceStateMachine] Rejected invalid transition: ${this.currentState} -> ${targetState} (reason: ${reason || 'none'})`);
      return false;
    }

    const oldState = this.currentState;
    this.currentState = targetState;
    console.log(`[VoiceStateMachine] Transition: ${oldState} -> ${targetState} (${reason || 'system'})`);

    for (const listener of this.listeners) {
      try {
        listener(targetState, oldState, reason);
      } catch (err) {
        console.error('[VoiceStateMachine] Error in state listener:', err);
      }
    }

    return true;
  }

  forceState(targetState: VoiceState, reason?: string) {
    const oldState = this.currentState;
    this.currentState = targetState;
    console.warn(`[VoiceStateMachine] Force Transition: ${oldState} -> ${targetState} (${reason || 'override'})`);
    for (const listener of this.listeners) {
      try {
        listener(targetState, oldState, reason);
      } catch {}
    }
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}
