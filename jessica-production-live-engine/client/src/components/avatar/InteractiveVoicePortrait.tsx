/**
 * client/src/components/avatar/InteractiveVoicePortrait.tsx
 * 
 * Interactive 2D Peptide Specialist Voice Portrait.
 * Features Real-Time Radial Sound Bars, Concentric Acoustic Sound Waves,
 * and Live Audio Spectrum Visualization driven directly by Gemini Live (Charon voice).
 * 
 * Capabilities:
 * 1. 360-degree Radial Sound Bars that bounce and modulate to actual voice frequencies (FFT)
 * 2. Expanding acoustic shockwave ripples radiating outward during speech and listening
 * 3. State-driven dynamic aura (Speaking = Electric Cyan/Gold, Listening = Emerald, Idle = Subtle Pulse)
 * 4. High-contrast horizontal audio spectrum equalizer underneath the portrait
 * 5. 100% pure presentation layer (Zero external domain leaks)
 */

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, Mic, Sparkles, Activity, ShieldCheck } from 'lucide-react';

export interface InteractiveVoicePortraitProps {
  connectionState: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  userAudioLevel: number;
  agentAudioLevel: number;
  outputAnalyser?: AnalyserNode | null;
  className?: string;
  portraitSrc?: string;
  onConnectClick?: () => void;
}

export function InteractiveVoicePortrait({
  connectionState,
  userAudioLevel,
  agentAudioLevel,
  outputAnalyser,
  className = '',
  portraitSrc = '/persona.jpg',
  onConnectClick
}: InteractiveVoicePortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Synchronized refs to avoid re-mounting animation loops
  const userAudioRef = useRef(userAudioLevel);
  userAudioRef.current = userAudioLevel;

  const agentAudioRef = useRef(agentAudioLevel);
  agentAudioRef.current = agentAudioLevel;

  const analyserRef = useRef(outputAnalyser);
  analyserRef.current = outputAnalyser;

  const connStateRef = useRef(connectionState);
  connStateRef.current = connectionState;

  // Active Live Conversation States in GeminiLiveClient
  const ACTIVE_LIVE_STATES = [
    'CONNECTED',
    'READY',
    'LISTENING',
    'THINKING',
    'USER_SPEAKING',
    'SPEAKING',
    'WAITING_FOR_TURN_COMPLETE',
    'INTERRUPTED'
  ];

  // Local state for smooth UI transitions
  const isConnected = ACTIVE_LIVE_STATES.includes(connectionState);
  const isConnecting = connectionState === 'CONNECTING';
  const isSpeaking = (isConnected || isConnecting) && agentAudioLevel > 0.04;
  const isListening = (isConnected || isConnecting) && userAudioLevel > 0.05 && !isSpeaking;

  // Real-time Canvas Radial Visualizer & Sound Wave Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDisposed = false;
    const fftSize = 128;
    const freqBuffer = new Uint8Array(fftSize);

    // Dynamic wave ripples state
    const ripples: { radius: number; alpha: number; speed: number; maxRadius: number }[] = [
      { radius: 88, alpha: 0.8, speed: 0.8, maxRadius: 155 },
      { radius: 110, alpha: 0.5, speed: 0.6, maxRadius: 155 },
      { radius: 132, alpha: 0.2, speed: 0.5, maxRadius: 155 }
    ];

    let lastTime = performance.now();
    const NUM_BARS = 48; // 48 radial frequency bars around circle

    const render = (now: number) => {
      if (isDisposed) return;
      animFrameRef.current = requestAnimationFrame(render);

      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const t = now / 1000;

      const userVol = userAudioRef.current;
      const agentVol = agentAudioRef.current;
      const analyser = analyserRef.current;
      const conn = connStateRef.current;
      const isLiveConn = ACTIVE_LIVE_STATES.includes(conn) || conn === 'CONNECTING';
      const speaking = isLiveConn && agentVol > 0.04;
      const listening = isLiveConn && userVol > 0.05 && !speaking;

      // Extract frequency spectrum if analyser is active
      let avgFreq = agentVol;
      if (analyser && speaking) {
        try {
          analyser.getByteFrequencyData(freqBuffer);
          let sum = 0;
          for (let i = 0; i < 32; i++) sum += freqBuffer[i];
          avgFreq = Math.max(agentVol, sum / (32 * 255));
        } catch {
          avgFreq = agentVol;
        }
      }

      // Canvas dimensions & High-DPI Scaling
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const portraitRadius = 76; // Inner radius for portrait boundary

      ctx.clearRect(0, 0, width, height);

      // ── 1. AMBIENT GLOW & AURA ─────────────────────────────────────────
      if (isLiveConn) {
        const glowRadius = portraitRadius + 50 + (speaking ? avgFreq * 35 : listening ? userVol * 30 : Math.sin(t * 2) * 5);
        const glowGrad = ctx.createRadialGradient(centerX, centerY, portraitRadius - 10, centerX, centerY, glowRadius);

        if (speaking) {
          glowGrad.addColorStop(0, 'rgba(6, 182, 212, 0.25)'); // Cyan core
          glowGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.15)'); // Emerald mid
          glowGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
        } else if (listening) {
          glowGrad.addColorStop(0, 'rgba(16, 185, 129, 0.3)'); // Emerald green
          glowGrad.addColorStop(0.6, 'rgba(52, 211, 153, 0.15)');
          glowGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        } else {
          // Connected idle subtle breathing glow
          const breath = 0.08 + Math.sin(t * 1.5) * 0.04;
          glowGrad.addColorStop(0, `rgba(6, 182, 212, ${breath})`);
          glowGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
        }

        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 2. CONCENTRIC SOUND WAVE RIPPLES ───────────────────────────────
      if (isLiveConn) {
        const activeMultiplier = speaking ? Math.max(0.5, avgFreq * 2.2) : listening ? Math.max(0.5, userVol * 2.0) : 0.2;

        ripples.forEach((ripple, idx) => {
          ripple.radius += ripple.speed * (1 + activeMultiplier * 2.5);
          if (ripple.radius > ripple.maxRadius) {
            ripple.radius = portraitRadius + 8;
          }

          // Compute ripple fade based on distance from center
          const progress = (ripple.radius - portraitRadius) / (ripple.maxRadius - portraitRadius);
          const alpha = Math.max(0, (1 - progress) * (speaking ? 0.6 : listening ? 0.5 : 0.15));

          ctx.beginPath();
          ctx.arc(centerX, centerY, ripple.radius, 0, Math.PI * 2);
          ctx.strokeStyle = speaking
            ? `rgba(34, 211, 238, ${alpha})` // Cyan
            : listening
              ? `rgba(52, 211, 153, ${alpha})` // Emerald
              : `rgba(71, 85, 105, ${alpha * 0.5})`; // Slate idle
          ctx.lineWidth = 1.5 + (1 - progress) * 2;
          ctx.stroke();
        });
      }

      // ── 3. 360-DEGREE RADIAL FREQUENCY SOUND BARS ──────────────────────
      const innerBarRadius = portraitRadius + 6;
      const angleStep = (Math.PI * 2) / NUM_BARS;

      for (let i = 0; i < NUM_BARS; i++) {
        const angle = i * angleStep - Math.PI / 2; // Start from top 12 o'clock

        // Map bar index to frequency buffer (symmetric or circular)
        const freqIndex = Math.floor(Math.abs(Math.sin((i / NUM_BARS) * Math.PI)) * 24);
        const rawFreq = freqBuffer[freqIndex] ? freqBuffer[freqIndex] / 255 : 0;

        let barLength = 4; // Base idle height

        if (speaking) {
          // Dynamic frequency-modulated height with vocal formant peak
          const formantBoost = Math.sin(i * 0.7 + t * 6) * 0.2 + 0.8;
          const speechPulse = (rawFreq * 0.7 + avgFreq * 0.5) * formantBoost;
          barLength = 5 + speechPulse * 38;
        } else if (listening) {
          // Responsive harmonic wave driven by user voice
          const wave = Math.sin(angle * 4 + t * 8) * 0.35 + 0.65;
          barLength = 5 + userVol * 32 * wave;
        } else if (isLiveConn) {
          // Calm undulating idle rhythm
          const idleWave = Math.sin(angle * 3 + t * 2.5) * 2.5;
          barLength = 5 + idleWave;
        } else {
          // Offline / Disconnected subtle tick marks
          barLength = 3;
        }

        const x1 = centerX + Math.cos(angle) * innerBarRadius;
        const y1 = centerY + Math.sin(angle) * innerBarRadius;
        const x2 = centerX + Math.cos(angle) * (innerBarRadius + barLength);
        const y2 = centerY + Math.sin(angle) * (innerBarRadius + barLength);

        // Bar Color Gradient
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (speaking) {
          // Dynamic dual-tone gradient (cyan to golden amber)
          const barGrad = ctx.createLinearGradient(x1, y1, x2, y2);
          barGrad.addColorStop(0, '#06b6d4'); // Cyan base
          barGrad.addColorStop(0.7, '#10b981'); // Emerald mid
          barGrad.addColorStop(1, '#fbbf24'); // Gold peak
          ctx.strokeStyle = barGrad;
          ctx.lineWidth = 3.2;
          ctx.lineCap = 'round';
        } else if (listening) {
          ctx.strokeStyle = '#34d399'; // Emerald
          ctx.lineWidth = 3.0;
          ctx.lineCap = 'round';
        } else if (conn === 'CONNECTED') {
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)'; // Subtle cyan
          ctx.lineWidth = 2.0;
          ctx.lineCap = 'round';
        } else {
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)'; // Muted slate
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'butt';
        }

        ctx.stroke();
      }

      // ── 4. OUTER ORBITAL SOUND PARTICLES ──────────────────────────────
      if (speaking || listening) {
        const particleCount = 8;
        for (let p = 0; p < particleCount; p++) {
          const pAngle = t * (speaking ? 1.8 : 1.2) + (p * (Math.PI * 2 / particleCount));
          const pDist = innerBarRadius + 22 + Math.sin(pAngle * 3 + t * 4) * 12;
          const px = centerX + Math.cos(pAngle) * pDist;
          const py = centerY + Math.sin(pAngle) * pDist;
          const pAlpha = 0.4 + Math.sin(t * 3 + p) * 0.3;

          ctx.beginPath();
          ctx.arc(px, py, speaking ? 2.5 : 2.0, 0, Math.PI * 2);
          ctx.fillStyle = speaking ? `rgba(34, 211, 238, ${pAlpha})` : `rgba(52, 211, 153, ${pAlpha})`;
          ctx.fill();
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDisposed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <div className={`relative flex flex-col items-center justify-center select-none w-full max-w-full overflow-hidden ${className}`}>
      {/* ── SOUND WAVE & RADIAL BAR CANVAS CONTAINER ────────────────────── */}
      <div className="relative w-[260px] h-[260px] sm:w-[320px] sm:h-[320px] flex items-center justify-center mx-auto">
        {/* Real-time HTML5 Sound Wave Canvas */}
        <canvas
          ref={canvasRef}
          width={320}
          height={320}
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
        />

        {/* ── CENTRAL PHOTOREALISTIC SPECIALIST PORTRAIT ─────────────────── */}
        <div className="relative z-10">
          <div
            className={`w-32 h-32 sm:w-40 sm:h-40 rounded-full p-1 sm:p-1.5 transition-all duration-300 flex items-center justify-center ${
              isSpeaking
                ? 'bg-gradient-to-tr from-cyan-500 via-teal-400 to-amber-400 shadow-2xl shadow-cyan-500/50 ring-4 ring-cyan-500/30 scale-[1.03]'
                : isListening
                  ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 shadow-2xl shadow-emerald-500/50 ring-4 ring-emerald-500/40 scale-[1.02]'
                  : isConnected
                    ? 'bg-gradient-to-tr from-cyan-600/70 via-teal-500/60 to-emerald-600/70 shadow-lg shadow-cyan-900/30 ring-2 ring-cyan-500/20'
                    : 'bg-zinc-800 ring-1 ring-zinc-700/60'
            }`}
          >
            {/* Inner Circular Frame */}
            <div className="w-full h-full rounded-full overflow-hidden bg-zinc-950 border-2 border-zinc-900 shadow-inner relative group">
              <img
                src={portraitSrc}
                alt="Peptide Specialist"
                className={`w-full h-full object-cover object-top filter brightness-105 contrast-105 transition-transform duration-500 ${
                  isSpeaking ? 'scale-105' : isListening ? 'scale-102' : 'scale-100'
                }`}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />

              {/* Offline Overlay if Disconnected */}
              {!isConnected && (
                <div 
                  onClick={onConnectClick}
                  className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-2 text-center"
                >
                  <Sparkles className="w-5 h-5 text-cyan-400 mb-1" />
                  <span className="text-[11px] font-semibold text-white">Start Voice Session</span>
                </div>
              )}
            </div>
          </div>

          {/* Connection & Microphone Status Badge (Bottom Right of Circle) */}
          <div
            className={`absolute bottom-1 right-2 w-6 h-6 rounded-full border-2 border-zinc-950 flex items-center justify-center shadow-lg transition-all duration-300 ${
              isConnected
                ? isSpeaking
                  ? 'bg-cyan-500 shadow-cyan-500/60'
                  : isListening
                    ? 'bg-emerald-500 shadow-emerald-500/60'
                    : 'bg-emerald-500 shadow-emerald-500/40'
                : 'bg-zinc-600'
            }`}
          >
            {isSpeaking ? (
              <Volume2 className="w-3 h-3 text-white animate-pulse" />
            ) : isListening ? (
              <Mic className="w-3 h-3 text-white animate-pulse" />
            ) : isConnected ? (
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {/* ── HORIZONTAL FREQUENCY EQUALIZER STRIP (Directly Under Portrait) ─ */}
      <div className="flex flex-col items-center space-y-2 -mt-3">
        {/* Equalizer Spectrum Bars */}
        <div className="flex items-center gap-1 h-5 px-3 py-1 rounded-full bg-zinc-950/80 border border-zinc-800/80 backdrop-blur-md shadow-md">
          {Array.from({ length: 18 }).map((_, barIdx) => {
            const centerDist = Math.abs(barIdx - 8.5) / 8.5; // 0 at center, 1 at edges
            let barH = 3;

            if (isSpeaking) {
              const wave = Math.sin(barIdx * 0.6 + performance.now() * 0.008) * 0.5 + 0.5;
              const intensity = (1.0 - centerDist * 0.4) * (agentAudioLevel * 0.7 + wave * 0.3);
              barH = Math.max(3, Math.min(16, intensity * 20));
            } else if (isListening) {
              const wave = Math.sin(barIdx * 0.8 + performance.now() * 0.01) * 0.5 + 0.5;
              barH = Math.max(3, Math.min(15, (userAudioLevel * 0.8 + wave * 0.2) * 18));
            } else if (isConnected) {
              barH = 3 + Math.sin(barIdx * 0.4 + performance.now() * 0.003) * 1.5;
            }

            return (
              <span
                key={barIdx}
                className={`w-1 rounded-full transition-all duration-75 ${
                  isSpeaking
                    ? 'bg-gradient-to-t from-cyan-500 to-amber-400'
                    : isListening
                      ? 'bg-gradient-to-t from-emerald-600 to-teal-300'
                      : isConnected
                        ? 'bg-cyan-500/40'
                        : 'bg-zinc-700/50'
                }`}
                style={{ height: `${barH}px` }}
              />
            );
          })}
        </div>

        {/* Live Interaction Audio State Label */}
        <div className="flex items-center justify-center text-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-mono text-zinc-400 px-3 max-w-full">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isSpeaking
                ? 'bg-cyan-400 animate-pulse'
                : isListening
                  ? 'bg-emerald-400 animate-pulse ring-2 ring-emerald-400/30'
                  : isConnected
                    ? 'bg-emerald-500'
                    : 'bg-zinc-600'
            }`}
          />
          <span className="font-semibold text-zinc-300 truncate">
            {isSpeaking
              ? 'Specialist Speaking (Charon Voice)'
              : isListening
                ? 'Listening to Your Query...'
                : isConnected
                  ? 'Specialist Ready • Ask Any Question'
                  : 'Specialist Offline • Tap to Connect'}
          </span>
        </div>
      </div>
    </div>
  );
}
