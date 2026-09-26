import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, MessageSquare, Phone, PhoneOff, ShieldAlert, Cpu, Sparkles, Activity } from 'lucide-react';
import { SalesDeskState } from '../../services/salesDesk/salesOrchestrator';

interface VoiceUIProps {
  state: SalesDeskState;
  onInterrupt: () => void;
  onToggleMic: () => void;
  onSwitchToClassic: () => void;
  onReplaySpeech: () => void;
  onCommitSpeech?: () => void;
}

export function VoiceUI({ state, onInterrupt, onToggleMic, onSwitchToClassic, onReplaySpeech, onCommitSpeech }: VoiceUIProps) {
  const { voiceState, salesStage, buyerContext, messages, interimTranscript } = state;
  
  // Single-pass reverse scan to find latest messages without allocating intermediate arrays (M2)
  let lastAssistantMsg = undefined;
  let lastUserMsg = undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!lastAssistantMsg && m.role === 'assistant') lastAssistantMsg = m;
    if (!lastUserMsg && m.role === 'user') lastUserMsg = m;
    if (lastAssistantMsg && lastUserMsg) break;
  }

  const [callDuration, setCallDuration] = useState(0);
  const startTimeRef = React.useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // State-specific visualizer styling and labels
  const getVisualizerConfig = () => {
    switch (voiceState) {
      case 'speaking':
        return {
          label: 'JESSICA SPEAKING',
          sub: 'At your service • Attentive and ready',
          color: 'from-brand-cyan via-white to-brand-purple',
          glow: 'rgba(0, 243, 255, 0.6)',
          pulseDuration: 0.8,
          bars: [0.9, 0.7, 1.0, 0.8, 0.6, 0.9, 0.8, 1.0]
        };
      case 'user_speaking':
      case 'listening':
        if (interimTranscript || voiceState === 'user_speaking') {
          return {
            label: 'CLIENT SPEAKING • TAP ORB TO SEND',
            sub: 'Listening to your voice... (tap orb when finished)',
            color: 'from-green-400 via-emerald-500 to-green-300',
            glow: 'rgba(74, 222, 128, 0.6)',
            pulseDuration: 0.5,
            bars: [0.8, 1.0, 0.7, 0.9, 1.0, 0.8, 0.9, 0.7]
          };
        }
        return {
          label: 'LISTENING • SPEAK NOW',
          sub: 'Speak naturally or tap orb when finished',
          color: 'from-brand-cyan via-brand-cyan/60 to-brand-cyan/20',
          glow: 'rgba(0, 243, 255, 0.4)',
          pulseDuration: 1.5,
          bars: [0.4, 0.7, 0.5, 0.8, 0.6, 0.7, 0.5, 0.8]
        };
      case 'thinking':
        return {
          label: 'FORMULATING RECOMMENDATION',
          sub: 'Reviewing catalog & lending arrangements...',
          color: 'from-brand-purple via-brand-cyan to-brand-purple',
          glow: 'rgba(168, 85, 247, 0.5)',
          pulseDuration: 1.0,
          bars: [0.5, 0.7, 0.9, 0.6, 0.8, 0.5, 0.7, 0.9]
        };
      case 'interrupted':
        return {
          label: 'INTERRUPTED',
          sub: 'Audio paused • Listening to client',
          color: 'from-yellow-400 via-amber-500 to-yellow-300',
          glow: 'rgba(250, 204, 21, 0.5)',
          pulseDuration: 0.5,
          bars: [0.4, 0.6, 0.5, 0.7, 0.4, 0.5, 0.6, 0.4]
        };
      case 'error':
        return {
          label: 'MIC NOT CONNECTED',
          sub: 'Microphone permission needed or use text below',
          color: 'from-red-500 via-rose-600 to-red-400',
          glow: 'rgba(239, 68, 68, 0.5)',
          pulseDuration: 1.5,
          bars: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
        };
      case 'idle':
      default:
        return {
          label: 'MICROPHONE PAUSED',
          sub: 'Tap microphone icon to speak with Jessica',
          color: 'from-white/40 via-white/20 to-transparent',
          glow: 'rgba(255, 255, 255, 0.1)',
          pulseDuration: 3.0,
          bars: [0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3]
        };
    }
  };

  const config = getVisualizerConfig();

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-4 md:p-6 w-full max-w-4xl mx-auto h-full overflow-hidden">
      {/* ── Top Phone Call HUD Bar ── */}
      <div className="w-full flex items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
          <span className="font-mono text-xs text-white uppercase tracking-wider font-bold flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-green-400" />
            <span>LIVE CALL // SALES DESK</span>
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-brand-cyan">
            {formatDuration(callDuration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-block px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[9px] font-mono text-white/70 uppercase">
            STAGE: <strong className="text-white">{salesStage}</strong>
          </span>
          <button
            onClick={onSwitchToClassic}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/40 text-[10px] font-mono text-brand-cyan uppercase tracking-wider transition-all cursor-pointer"
          >
            <MessageSquare className="w-3 h-3" />
            <span>Switch to Text</span>
          </button>
        </div>
      </div>

      {/* ── Middle Visualizer & Live Audio Reactive Sphere ── */}
      <div className="flex-1 flex flex-col items-center justify-center my-4 relative w-full">
        {/* Ambient Glow */}
        <motion.div
          animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: config.pulseDuration, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute w-48 h-48 md:w-64 md:h-64 rounded-full blur-[70px] pointer-events-none"
          style={{ background: config.glow }}
        />

        {/* Central Dynamic Voice Sphere */}
        <div 
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (voiceState === 'speaking') {
                onInterrupt();
              } else {
                (onCommitSpeech || onToggleMic)();
              }
            }
          }}
          className="relative flex items-center justify-center cursor-pointer active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-brand-cyan/50 rounded-full" 
          onClick={voiceState === 'speaking' ? onInterrupt : (onCommitSpeech || onToggleMic)}
          title={voiceState === 'speaking' ? 'Tap to interrupt Jessica' : 'Tap when finished speaking to send immediately'}
          aria-label={voiceState === 'speaking' ? 'Interrupt Jessica' : 'Send message immediately'}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            className={`w-36 h-36 md:w-44 md:h-44 rounded-full border border-white/20 p-2 flex items-center justify-center shadow-2xl relative`}
          >
            <div className={`w-full h-full rounded-full bg-gradient-to-tr ${config.color} p-[2px] flex items-center justify-center`}>
              <div className="w-full h-full bg-bg-dark/90 rounded-full backdrop-blur-xl flex items-center justify-center">
                {voiceState === 'speaking' ? (
                  <Volume2 className="w-10 h-10 md:w-12 md:h-12 text-brand-cyan animate-pulse" />
                ) : interimTranscript || voiceState === 'interrupted' ? (
                  <Mic className="w-10 h-10 md:w-12 md:h-12 text-green-400 animate-pulse" />
                ) : (
                  <Mic className="w-10 h-10 md:w-12 md:h-12 text-white/70" />
                )}
              </div>
            </div>
          </motion.div>

          {/* Dynamic Waveform Bars Surrounding Sphere */}
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
            {config.bars.map((barHeight, idx) => (
              <motion.span
                key={idx}
                animate={{ scaleY: [barHeight * 0.4, barHeight * 1.5, barHeight * 0.4] }}
                transition={{ duration: config.pulseDuration, repeat: Infinity, delay: idx * 0.08, ease: 'easeInOut' }}
                className="w-1 bg-brand-cyan rounded-full shadow-[0_0_8px_rgba(0,243,255,0.6)]"
                style={{ height: `${barHeight * 36}px` }}
              />
            ))}
          </div>
        </div>

        {/* State Label & Subtitle */}
        <div className="text-center mt-6 z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono font-bold tracking-widest text-white uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-brand-cyan animate-ping" />
            {config.label}
          </div>
          <p className="text-xs text-white/50 font-sans tracking-wide">
            {config.sub}
          </p>
        </div>
      </div>

      {/* ── Live Transcripts & Spoken Dialogue Subtitle Box ── */}
      <div 
        aria-live="polite"
        aria-atomic="false"
        className="w-full bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-5 flex flex-col gap-3 min-h-[140px] max-h-[220px] overflow-y-auto"
      >
        {/* User Partial / Interim Speech Readout */}
        {interimTranscript && (
          <div className="flex items-center justify-between gap-2.5 bg-brand-cyan/10 border border-brand-cyan/30 p-3 rounded-xl shadow-[0_0_15px_rgba(0,243,255,0.15)]">
            <div className="flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse mt-1 shrink-0 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
              <div className="flex flex-col text-left">
                <span className="text-[9px] font-mono uppercase tracking-widest text-brand-cyan font-bold">You (Speaking...)</span>
                <p className="text-sm text-white font-sans font-medium italic">{interimTranscript}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[8px] font-mono uppercase text-brand-cyan/70 hidden sm:inline">Pause to finish</span>
              {onCommitSpeech && (
                <button
                  onClick={onCommitSpeech}
                  className="px-2 py-1 rounded-lg bg-green-500/80 hover:bg-green-400 text-bg-dark font-mono text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_8px_rgba(74,222,128,0.3)]"
                  title="Send immediately without waiting for silence"
                >
                  Send &rarr;
                </button>
              )}
            </div>
          </div>
        )}

        {/* Last Confirmed User Message */}
        {!interimTranscript && lastUserMsg && (
          <div className="flex items-start gap-2 text-left opacity-70">
            <span className="text-[10px] font-mono text-brand-cyan uppercase font-bold shrink-0">You:</span>
            <p className="text-xs text-white/80 font-sans">{lastUserMsg.content}</p>
          </div>
        )}

        {/* Spoken AI Response Subtitle */}
        {lastAssistantMsg && (
          <div className="flex items-start justify-between gap-3 text-left border-t border-white/5 pt-2">
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono text-brand-cyan uppercase font-bold shrink-0">Jessica:</span>
              <p className="text-sm text-white font-sans leading-relaxed">{lastAssistantMsg.content}</p>
            </div>
            <button
              onClick={onReplaySpeech}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 text-brand-cyan text-[10px] font-mono uppercase tracking-wider shrink-0 transition-all cursor-pointer"
              title="Replay Voice Synthesis"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Play</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom Controls Bar ── */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2.5 pt-3">
        {/* Main Action Button (Interrupt or Send Turn) */}
        {voiceState === 'speaking' ? (
          <button
            onClick={onInterrupt}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-cyan/20 hover:bg-brand-cyan/30 border border-brand-cyan/50 text-xs font-mono uppercase tracking-wider text-brand-cyan transition-all cursor-pointer animate-pulse shadow-[0_0_15px_rgba(0,243,255,0.2)]"
          >
            <VolumeX className="w-4 h-4" />
            <span>Tap to Speak (Interrupt Jessica)</span>
          </button>
        ) : (
          <button
            onClick={onCommitSpeech || onToggleMic}
            disabled={voiceState === 'thinking'}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500/20 hover:bg-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed border border-green-500/50 text-xs font-mono uppercase tracking-wider text-green-400 transition-all cursor-pointer shadow-[0_0_15px_rgba(74,222,128,0.2)]"
          >
            <Mic className="w-4 h-4 text-green-400 animate-pulse" />
            <span>Tap When Done Speaking (Send)</span>
          </button>
        )}

        <button
          onClick={onSwitchToClassic}
          className="flex items-center gap-2 px-4 py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-xs font-mono uppercase tracking-wider hover:bg-white transition-all cursor-pointer shadow-[0_0_15px_rgba(0,243,255,0.3)] shrink-0"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden sm:inline">Type Mode</span>
        </button>
      </div>
    </div>
  );
}
