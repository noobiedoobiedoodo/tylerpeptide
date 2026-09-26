/**
 * client/src/components/avatar/GymAvatarCanvas.tsx
 * 
 * Live Full-Body 3D Virtual Human Bodybuilder Specialist Canvas.
 * Golden Era Gym Environment + Real-Time Gemini Live Audio-Driven Lip-Sync.
 * 
 * Core Capabilities:
 * 1. Fictional full-body male competitive bodybuilder in an old-school gym
 * 2. Real-time lip-sync and visemes driven directly by Gemini Live audio (AnalyserNode)
 * 3. 4 animation states: IDLE, LISTENING, SPEAKING, TRAINING (Dumbbell Curl)
 * 4. Immediate interruptibility (speaking or listening pauses curl smoothly)
 * 5. Robust fallback: Graceful fallback to 2D photorealistic avatar if WebGL fails
 * 6. Isolated presentation layer: Zero legacy CRM or external domain dependencies
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GymEnvironment } from './GymEnvironment';
import { BodybuilderCharacter } from './BodybuilderCharacter';
import { DuckBodybuilderCharacter } from './DuckBodybuilderCharacter';
import { AvatarState, VisemeWeights, GymAvatarProps } from './types';
import { Dumbbell, Activity, Eye, Volume2, ShieldCheck, AlertCircle } from 'lucide-react';

export function GymAvatarCanvas({
  connectionState,
  userAudioLevel,
  agentAudioLevel,
  outputAnalyser,
  onStateChange,
  className = '',
  fallbackEnabled = false
}: GymAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Runtime State
  const [avatarState, setAvatarState] = useState<AvatarState>('IDLE');
  const [characterModelType, setCharacterModelType] = useState<'duck' | 'human'>('duck');
  const [fps, setFps] = useState<number>(60);
  const [frameTimeMs, setFrameTimeMs] = useState<number>(16.6);
  const [webGlSupported, setWebGlSupported] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isTrainingManual, setIsTrainingManual] = useState<boolean>(false);

  // References for Animation & Scene Management
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const environmentRef = useRef<GymEnvironment | null>(null);
  const duckCharacterRef = useRef<DuckBodybuilderCharacter | null>(null);
  const humanCharacterRef = useRef<BodybuilderCharacter | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Audio Analysis Buffers
  const frequencyBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const visemesRef = useRef<VisemeWeights>({
    jawOpen: 0,
    mouthPucker: 0,
    mouthSmile: 0,
    mouthOpen: 0,
    browInnerUp: 0,
    eyeBlink: 0
  });

  // Synchronized prop refs for 60 FPS animation loop (prevents scene tear-down on audio level changes)
  const userAudioLevelRef = useRef(userAudioLevel);
  userAudioLevelRef.current = userAudioLevel;

  const agentAudioLevelRef = useRef(agentAudioLevel);
  agentAudioLevelRef.current = agentAudioLevel;

  const outputAnalyserRef = useRef(outputAnalyser);
  outputAnalyserRef.current = outputAnalyser;

  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const characterModelTypeRef = useRef(characterModelType);
  characterModelTypeRef.current = characterModelType;

  // Check WebGL availability
  useEffect(() => {
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) {
        setWebGlSupported(false);
      }
    } catch {
      setWebGlSupported(false);
    }
  }, []);

  // Initialize Three.js Scene, Camera, Gym Environment & Bodybuilder Characters
  useEffect(() => {
    if (!webGlSupported || !canvasRef.current || !containerRef.current) return;

    let isDisposed = false;

    try {
      // 1. Scene & Camera Setup
      const width = containerRef.current.clientWidth || 400;
      const height = containerRef.current.clientHeight || 440;

      const scene = new THREE.Scene();
      // Bright, daylight airy gym interior ambiance
      scene.background = new THREE.Color(0xdce5ef);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40);
      // Position camera framed on the bodybuilder's upper body and chest/dumbbell
      camera.position.set(0, 0.35, 3.4);
      camera.lookAt(0, 0.1, 0);
      cameraRef.current = camera;

      // 2. WebGLRenderer with high-efficiency settings
      const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      rendererRef.current = renderer;

      // 3. Gym Environment
      const environment = new GymEnvironment();
      scene.add(environment.group);
      environmentRef.current = environment;

      // 4. Bodybuilder Characters (Duck GLB & Classic Human)
      const duckCharacter = new DuckBodybuilderCharacter();
      const humanCharacter = new BodybuilderCharacter();
      duckCharacterRef.current = duckCharacter;
      humanCharacterRef.current = humanCharacter;

      if (characterModelTypeRef.current === 'duck') {
        scene.add(duckCharacter.group);
      } else {
        scene.add(humanCharacter.group);
      }

      // 5. Audio Frequency Data Buffer (fftSize 256 -> 128 bins)
      frequencyBufferRef.current = new Uint8Array(128);

      // 6. Resize Observer
      const handleResize = () => {
        if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
        const newWidth = containerRef.current.clientWidth;
        const newHeight = containerRef.current.clientHeight;
        cameraRef.current.aspect = newWidth / newHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(newWidth, newHeight);
      };

      window.addEventListener('resize', handleResize);

      // 7. Main 60 FPS Render Loop
      let lastTime = performance.now();
      let frameCount = 0;
      let lastFpsTime = lastTime;

      const animate = (currentTime: number) => {
        if (isDisposed) return;
        animFrameIdRef.current = requestAnimationFrame(animate);

        const dt = Math.min((currentTime - lastTime) / 1000, 0.05); // Cap max dt
        const frameTime = currentTime - lastTime;
        lastTime = currentTime;

        // FPS Calculation
        frameCount++;
        if (currentTime - lastFpsTime >= 500) {
          setFps(Math.round((frameCount * 1000) / (currentTime - lastFpsTime)));
          setFrameTimeMs(parseFloat(frameTime.toFixed(1)));
          frameCount = 0;
          lastFpsTime = currentTime;
        }

        // ── Real-Time Audio Viseme Processing ───────────────────────────
        const visemes = visemesRef.current;
        const analyser = outputAnalyserRef.current;
        const freqData = frequencyBufferRef.current;
        const currentAgentAudio = agentAudioLevelRef.current;
        const currentUserAudio = userAudioLevelRef.current;

        if (analyser && freqData && currentAgentAudio > 0.04) {
          try {
            analyser.getByteFrequencyData(freqData);

            // Band 1: Low Formants (100 - 450 Hz) -> Jaw opening (viseme_aa)
            let lowSum = 0;
            for (let i = 1; i <= 6; i++) lowSum += freqData[i];
            const lowAvg = lowSum / (6 * 255);

            // Band 2: Mid Formants (500 - 1500 Hz) -> Lip Rounding / Pucker (viseme_O)
            let midSum = 0;
            for (let i = 7; i <= 18; i++) midSum += freqData[i];
            const midAvg = midSum / (12 * 255);

            // Band 3: High Formants (1600 - 3500 Hz) -> Lip Spreading / Smile (viseme_I)
            let highSum = 0;
            for (let i = 19; i <= 40; i++) highSum += freqData[i];
            const highAvg = highSum / (22 * 255);

            // Target viseme weights
            const targetJaw = Math.min(1.0, lowAvg * 2.8 + currentAgentAudio * 0.8);
            const targetPucker = Math.min(1.0, midAvg * 2.2);
            const targetSmile = Math.min(1.0, highAvg * 1.8);

            // Smooth interpolation (attack: 24/s, release: 20/s)
            visemes.jawOpen = THREE.MathUtils.lerp(visemes.jawOpen, targetJaw, dt * 24);
            visemes.mouthPucker = THREE.MathUtils.lerp(visemes.mouthPucker, targetPucker, dt * 20);
            visemes.mouthSmile = THREE.MathUtils.lerp(visemes.mouthSmile, targetSmile, dt * 20);
            visemes.browInnerUp = THREE.MathUtils.lerp(visemes.browInnerUp, Math.min(1, targetJaw * 0.5), dt * 10);
          } catch {
            // Audio analyser fallback
            visemes.jawOpen = THREE.MathUtils.lerp(visemes.jawOpen, currentAgentAudio * 1.2, dt * 20);
          }
        } else {
          // Rapid clean mouth closure when speech ends (50ms snap shut)
          visemes.jawOpen = THREE.MathUtils.lerp(visemes.jawOpen, 0, dt * 28);
          visemes.mouthPucker = THREE.MathUtils.lerp(visemes.mouthPucker, 0, dt * 24);
          visemes.mouthSmile = THREE.MathUtils.lerp(visemes.mouthSmile, 0, dt * 24);
          visemes.browInnerUp = THREE.MathUtils.lerp(visemes.browInnerUp, 0, dt * 14);
        }

        // ── Character Animation Update ──────────────────────────────────
        const activeChar = characterModelTypeRef.current === 'duck' ? duckCharacterRef.current : humanCharacterRef.current;
        if (activeChar) {
          activeChar.update(currentTime / 1000, dt, currentUserAudio, currentAgentAudio, visemes);
          if (activeChar.state !== avatarState) {
            setAvatarState(activeChar.state);
            onStateChangeRef.current?.(activeChar.state);
          }
        }

        // ── Render 3D Frame ─────────────────────────────────────────────
        renderer.render(scene, camera);
      };

      animFrameIdRef.current = requestAnimationFrame(animate);

      return () => {
        isDisposed = true;
        window.removeEventListener('resize', handleResize);
        if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
        duckCharacter.dispose();
        humanCharacter.dispose();
        environment.dispose();
        renderer.dispose();
      };
    } catch (err) {
      console.error('[GymAvatarCanvas] 3D Initialization error:', err);
      setHasError(true);
    }
  }, [webGlSupported]);

  // Handle Dynamic Character Model Switch (Duck GLB vs Classic Human)
  useEffect(() => {
    if (!sceneRef.current || !duckCharacterRef.current || !humanCharacterRef.current) return;
    if (characterModelType === 'duck') {
      sceneRef.current.remove(humanCharacterRef.current.group);
      sceneRef.current.add(duckCharacterRef.current.group);
    } else {
      sceneRef.current.remove(duckCharacterRef.current.group);
      sceneRef.current.add(humanCharacterRef.current.group);
    }
  }, [characterModelType]);

  // Handle Manual Dumbbell Curl Trigger
  const handleTriggerCurl = useCallback(() => {
    const activeChar = characterModelType === 'duck' ? duckCharacterRef.current : humanCharacterRef.current;
    if (activeChar) {
      activeChar.triggerTraining(3); // 3 controlled curls
      setIsTrainingManual(true);
      setTimeout(() => setIsTrainingManual(false), 7500);
    }
  }, [characterModelType]);

  // ── FALLBACK RENDERER: If WebGL fails, render 2D Specialist Avatar ──────
  if (!webGlSupported || hasError || fallbackEnabled) {
    const isSpeaking = agentAudioLevel > 0.05;
    const isListening = userAudioLevel > 0.05 && !isSpeaking;

    return (
      <div className={`relative flex flex-col items-center justify-center p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800 ${className}`}>
        <div 
          className={`w-36 h-36 rounded-full p-1.5 transition-all duration-300 flex items-center justify-center ${
            isSpeaking
              ? 'bg-gradient-to-tr from-cyan-500 via-teal-400 to-emerald-400 shadow-2xl shadow-cyan-500/40 ring-4 ring-cyan-500/20'
              : isListening
                ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 shadow-2xl shadow-emerald-500/40 ring-4 ring-emerald-500/30'
                : 'bg-zinc-800'
          }`}
        >
          <div className="w-full h-full rounded-full overflow-hidden bg-zinc-950 border-2 border-zinc-900 shadow-inner">
            <img 
              src="/persona.jpg" 
              alt="Peptide Specialist" 
              className="w-full h-full object-cover object-top filter brightness-105"
            />
          </div>
        </div>
        <div className="mt-2 text-center space-y-0.5">
          <p className="text-xs font-semibold text-zinc-300">Photorealistic Specialist Mode</p>
          <p className="text-[10px] text-zinc-500">2D Voice Fallback Active</p>
        </div>
      </div>
    );
  }

  // ── LIVE 3D AVATAR CANVAS ──────────────────────────────────────────────
  const isSpeaking = avatarState === 'SPEAKING';
  const isListening = avatarState === 'LISTENING';
  const isTraining = avatarState === 'TRAINING';

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-[380px] sm:h-[440px] rounded-2xl overflow-hidden bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-black border border-zinc-800/90 shadow-2xl ${className}`}
    >
      {/* 3D WebGL Canvas */}
      <canvas 
        ref={canvasRef} 
        className="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
      />

      {/* Top Left: Specialist Identity & State Indicator + Model Switcher */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-950/80 backdrop-blur-md border border-zinc-800 text-xs shadow-lg">
          <span className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
            isSpeaking 
              ? 'bg-cyan-400 shadow-lg shadow-cyan-400/80 animate-pulse' 
              : isListening 
                ? 'bg-emerald-400 shadow-lg shadow-emerald-400/80 ring-2 ring-emerald-400/30' 
                : isTraining
                  ? 'bg-amber-400 shadow-lg shadow-amber-400/80 animate-bounce'
                  : 'bg-zinc-500'
          }`} />
          <span className="font-semibold text-white tracking-wide">
            {isSpeaking ? 'Speaking (Live Audio Sync)' : isListening ? 'Listening Attentively' : isTraining ? 'Controlled Dumbbell Curl' : 'Natural Idle'}
          </span>
        </div>

        {/* Model Switcher: Duck Bodybuilder (Default) vs Classic Human */}
        <div className="flex items-center gap-1 bg-zinc-950/85 backdrop-blur-md p-1 rounded-full border border-zinc-800 text-[10px] font-mono shadow-lg">
          <button
            onClick={() => setCharacterModelType('duck')}
            className={`px-2.5 py-0.5 rounded-full font-semibold transition-all cursor-pointer ${
              characterModelType === 'duck'
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🦆 Duck Bodybuilder
          </button>
          <button
            onClick={() => setCharacterModelType('human')}
            className={`px-2.5 py-0.5 rounded-full font-semibold transition-all cursor-pointer ${
              characterModelType === 'human'
                ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🏋️ Human Bodybuilder
          </button>
        </div>
      </div>

      {/* Top Right: Real-Time Performance Telemetry HUD */}
      <div className="absolute top-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-950/80 backdrop-blur-md border border-zinc-800 text-[10px] font-mono text-zinc-400 shadow-lg">
        <span className="text-emerald-400 font-bold">{fps} FPS</span>
        <span className="text-zinc-600">|</span>
        <span>{frameTimeMs}ms</span>
        <span className="text-zinc-600">|</span>
        <span className="text-cyan-400 uppercase font-semibold">3D WebGL</span>
      </div>

      {/* Bottom Center: Interactive Dumbbell Training Trigger & Controls */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-950/90 backdrop-blur-md border border-zinc-800 shadow-xl">
        <button
          onClick={handleTriggerCurl}
          disabled={isSpeaking || isListening || isTraining}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
            isTraining
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title="Trigger a controlled 3-rep dumbbell bicep curl (interruptible)"
        >
          <Dumbbell className="w-3.5 h-3.5 text-amber-400" />
          <span>{isTraining ? 'Curling 50 LB...' : 'Perform Dumbbell Curl'}</span>
        </button>

        <div className="h-3 w-px bg-zinc-800" />

        {/* Real-time audio lip-sync indicator */}
        <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 px-1">
          <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? 'text-cyan-400 animate-pulse' : 'text-zinc-600'}`} />
          <span className="hidden sm:inline">Charon Sync:</span>
          <span className={isSpeaking ? 'text-cyan-300 font-bold' : 'text-zinc-500'}>
            {isSpeaking ? `${Math.round(agentAudioLevel * 100)}%` : 'Active'}
          </span>
        </div>
      </div>

      {/* Bottom Left: Golden Era Venice Gym Indicator */}
      <div className="hidden sm:flex absolute bottom-3 left-3 items-center gap-1 text-[10px] font-mono text-zinc-500 bg-zinc-950/60 px-2 py-0.5 rounded border border-zinc-900">
        <span>Venice Beach Gym • 1982</span>
      </div>
    </div>
  );
}
