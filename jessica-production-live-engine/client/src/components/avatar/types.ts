/**
 * client/src/components/avatar/types.ts
 * 
 * Type definitions for the Live 3D Bodybuilder Virtual Specialist Avatar.
 * Strictly presentation layer — isolated virtual specialist avatar.
 */

export type AvatarState = 'IDLE' | 'LISTENING' | 'SPEAKING' | 'TRAINING';

export interface VisemeWeights {
  jawOpen: number;       // 0 to 1: Main jaw depression for vowels
  mouthPucker: number;   // 0 to 1: OO / U sounds
  mouthSmile: number;    // 0 to 1: EE / I sounds
  mouthOpen: number;     // 0 to 1: General oral aperture
  browInnerUp: number;   // 0 to 1: Expressive eyebrow raise
  eyeBlink: number;      // 0 to 1: Natural blink state
}

export interface AvatarPerformanceMetrics {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  memoryMb?: number;
  isStable: boolean;
}

export interface GymAvatarProps {
  connectionState: string;
  userAudioLevel: number;
  agentAudioLevel: number;
  outputAnalyser?: AnalyserNode | null;
  onStateChange?: (state: AvatarState) => void;
  className?: string;
  fallbackEnabled?: boolean;
}
