import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Mic,
  MicOff,
  Volume2,
  Power,
  X,
  Send,
  MessageSquare,
  Radio,
  User,
  Activity,
  RotateCcw,
  AlertTriangle,
  PhoneCall,
  Sun
} from 'lucide-react';
import { GeminiLiveClient, LiveConnectionState, MicStatus } from '../../services/voice/live/GeminiLiveClient';
import { WakeLockManager } from '../../services/voice/live/WakeLockManager';
import {
  BuyerIntelligenceState,
  mergeBuyerProfile,
  formDataToBuyerProfile
} from '../../services/voice/live/voiceLeadExtractor';
import { useStore } from '../../store/useStore';
import { JarvisBlueprintCards } from './JarvisBlueprintCards';
import { DiagnosticHUD } from './DiagnosticHUD';
import { diagnosticStore } from '../../services/voice/diagnostics/DiagnosticLogger';

const LEGACY_JARVIS_STORAGE_KEYS = [
  'jarvis_live_session',
  'jarvis_session_state',
  'jarvis_conversation_id',
  'jarvis_buyer_profile',
  'jarvis_lead_id'
];

function purgeLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_JARVIS_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

interface SalesDeskPageProps {
  onClose: () => void;
  initialMode?: 'voice' | 'text';
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'jarvis' | 'jessica';
  text: string;
  timestamp: number;
}

function generateMsgId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function SalesDeskPage({ onClose, initialMode = 'voice' }: SalesDeskPageProps) {
  // Mode toggle: 'voice' (default) vs 'text'
  const [activeMode, setActiveMode] = useState<'voice' | 'text'>(initialMode);

  // Live client connection state
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('DISCONNECTED');
  const [micStatus, setMicStatus] = useState<MicStatus>('unknown');
  const [isAudioUnlocked, setIsAudioUnlocked] = useState<boolean>(() => GeminiLiveClient.isAudioContextRunning());
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(() => WakeLockManager.getInstance().isLocked());
  const [isMuted, setIsMuted] = useState(false);
  const [userLevel, setUserLevel] = useState(0);
  const [jarvisLevel, setJarvisLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDiagnosticError, setActiveDiagnosticError] = useState<string | null>(diagnosticStore.getActiveError());

  // Real-time voice subtitles
  const [currentVoiceTranscript, setCurrentVoiceTranscript] = useState<string>('');
  const [lastUserSpeech, setLastUserSpeech] = useState<string>('');

  // Text chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isTextGenerating, setIsTextGenerating] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Text abort controller for in-flight text-chat requests (H5)
  const textAbortControllerRef = useRef<AbortController | null>(null);

  // Buyer Intelligence state isolated to sessionStorage
  const [buyerIntel, setBuyerIntel] = useState<BuyerIntelligenceState>(() => {
    try {
      const saved = sessionStorage.getItem('jarvis_live_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.timestamp && Date.now() - parsed.timestamp < 4 * 3600 * 1000) {
          return {
            profile: parsed.profile || {},
            metrics: null,
            crmStatus: 'IDLE',
            lastUpdated: parsed.timestamp
          };
        }
      }
    } catch {}
    return {
      profile: {},
      metrics: null,
      crmStatus: 'IDLE',
      lastUpdated: Date.now()
    };
  });

  const clientRef = useRef<GeminiLiveClient | null>(null);

  // Subscribe to diagnosticStore errors
  useEffect(() => {
    return diagnosticStore.subscribe(() => {
      setActiveDiagnosticError(diagnosticStore.getActiveError());
    });
  }, []);

  // Auto-scroll text chat to bottom
  useEffect(() => {
    if (activeMode === 'text') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isTextGenerating, activeMode]);

  // Spawns and configures the live client session
  const initClientSession = (forceNew = false) => {
    // 1. Clean up existing active client
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    // 2. If forcing a new restart, wipe local session memory & clear all UI logs
    if (forceNew) {
      try {
        sessionStorage.removeItem('jarvis_live_session');
        sessionStorage.removeItem('jarvis_live_conv_id');
      } catch {}
      purgeLegacyStorage();
      useStore.getState().reset();
      setChatMessages([]);
      setCurrentVoiceTranscript('');
      setLastUserSpeech('');
      setErrorMessage(null);
      diagnosticStore.clearActiveError();
      setBuyerIntel({
        profile: {},
        metrics: null,
        crmStatus: 'IDLE',
        lastUpdated: Date.now()
      });
    }

    // 3. Unlock audio context
    GeminiLiveClient.unlockAudioContext().then(running => {
      if (running) setIsAudioUnlocked(true);
    });

    const currentForm = useStore.getState().formData;
    const fromForm = forceNew ? {} : formDataToBuyerProfile(currentForm);

    let cachedProfile = {};
    let cachedConvId: string | undefined;
    let cachedLeadId: string | undefined;

    if (!forceNew) {
      try {
        const saved = sessionStorage.getItem('jarvis_live_session');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.timestamp && Date.now() - parsed.timestamp < 4 * 3600 * 1000) {
            cachedProfile = parsed.profile || {};
            cachedConvId = parsed.conversationId;
            cachedLeadId = parsed.leadId;
          }
        }
        if (!cachedConvId) {
          const fallbackConvId = sessionStorage.getItem('jarvis_live_conv_id');
          if (fallbackConvId) cachedConvId = fallbackConvId;
        }
      } catch {}
    }

    const initialProfile = mergeBuyerProfile(cachedProfile, fromForm);

    const client = new GeminiLiveClient(
      {
        onStateChange: (newState) => {
          setConnectionState(newState);
          if (newState === 'SPEAKING') {
            setErrorMessage(null);
            diagnosticStore.clearActiveError();
          }
        },
        onUserAudioLevel: (level) => {
          setUserLevel(level);
        },
        onJarvisAudioLevel: (level) => {
          setJarvisLevel(level);
        },
        onTranscript: ({ sender, text, isFinal }) => {
          if (sender === 'jarvis' || (sender as string) === 'jessica') {
            setCurrentVoiceTranscript(text);
            if (isFinal && text) {
              setChatMessages(prev => [
                ...prev,
                { id: generateMsgId('msg_jessica'), sender: 'jessica', text, timestamp: Date.now() }
              ]);
            }
          } else {
            setLastUserSpeech(text);
            if (isFinal && text) {
              setChatMessages(prev => [
                ...prev,
                { id: generateMsgId('msg_user'), sender: 'user', text, timestamp: Date.now() }
              ]);
              clientRef.current?.ingestUserTranscript(text);
            }
          }
        },
        onBuyerIntelligenceUpdated: (state) => {
          setBuyerIntel({ ...state });

          // 1. Cache to sessionStorage for session continuity across refresh/reconnect
          try {
            const currentConvId = clientRef.current?.getConversationId();
            if (currentConvId) {
              sessionStorage.setItem('jarvis_live_conv_id', currentConvId);
            }
            const currentLeadId = clientRef.current?.getLeadId();
            if (currentLeadId) {
              sessionStorage.setItem(
                'jarvis_live_session',
                JSON.stringify({
                  profile: state.profile,
                  conversationId: currentConvId,
                  leadId: currentLeadId,
                  timestamp: Date.now()
                })
              );
            }
          } catch {}

          // 2. Synchronize newly discovered intelligence back into app-wide useStore formData
          const storeForm = useStore.getState().formData;
          const updates: Partial<typeof storeForm> = {};
          if (state.profile.name && (!storeForm.name || storeForm.name === 'Player')) updates.name = state.profile.name;
          if (state.profile.phone && !storeForm.phone) updates.phone = state.profile.phone;
          if (state.profile.email && !storeForm.email) updates.email = state.profile.email;
          if (state.profile.vehicleType && !storeForm.vehicle) updates.vehicle = state.profile.vehicleType;
          if (state.profile.targetVehicle && !storeForm.selectedModel) updates.selectedModel = state.profile.targetVehicle;
          if (state.profile.monthlyIncome && !storeForm.income) updates.income = String(state.profile.monthlyIncome);
          if (state.profile.downPayment !== undefined && (!storeForm.downPayment || storeForm.downPayment === '0'))
            updates.downPayment = String(state.profile.downPayment);
          if (state.profile.employment && !storeForm.employment) updates.employment = state.profile.employment;

          if (Object.keys(updates).length > 0) {
            useStore.getState().updateFormData(updates);
          }
        },
        onError: (err) => {
          setErrorMessage(err);
        },
        onMicStatusChange: (status) => {
          setMicStatus(status);
        }
      },
      {
        initialProfile,
        conversationId: cachedConvId,
        leadId: cachedLeadId
      }
    );

    clientRef.current = client;
    try {
      const activeConvId = client.getConversationId();
      if (activeConvId) {
        sessionStorage.setItem('jarvis_live_conv_id', activeConvId);
      }
    } catch {}
    if (activeMode === 'text') {
      client.setAudioPlaybackSuppressed(true);
    }
    client.connect();
  };

  // Mount effect
  useEffect(() => {
    purgeLegacyStorage();
    initClientSession(false);

    // Keep screen awake while on Sales Desk page
    WakeLockManager.getInstance().request().catch(() => {});
    const unsubWakeLock = WakeLockManager.getInstance().onStateChange((locked) => {
      setIsWakeLockActive(locked);
    });

    return () => {
      unsubWakeLock();
      WakeLockManager.getInstance().release().catch(() => {});
      if (textAbortControllerRef.current) {
        textAbortControllerRef.current.abort();
        textAbortControllerRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  // Action: Explicit User Gesture Activation (Mobile Autoplay & Mic Permission Compliance)
  const handleActivateSalesDesk = async () => {
    WakeLockManager.getInstance().request().catch(() => {});
    const running = await GeminiLiveClient.unlockAudioContext();
    setIsAudioUnlocked(running);
    if (clientRef.current) {
      try {
        await clientRef.current.enableMicrophone();
      } catch (e) {
        console.warn('[SalesDeskPage] Failed to enable microphone:', e);
      }
    }
  };

  // Action: Clear conversation and restart clean 1-to-1 session
  const handleRestartConversation = async () => {
    if (textAbortControllerRef.current) {
      textAbortControllerRef.current.abort();
      textAbortControllerRef.current = null;
    }
    if (clientRef.current) {
      try {
        await clientRef.current.restartSession();
      } catch (e) {
        console.warn('[SalesDeskPage] Failed to restart session:', e);
      }
    }
    initClientSession(true);
  };

  const handleToggleMute = () => {
    if (!clientRef.current) return;
    const nextMuted = clientRef.current.toggleMute();
    setIsMuted(nextMuted);
  };

  const handleSendTextMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!textInput.trim() || isTextGenerating) return;

    const messageText = textInput.trim();
    setTextInput('');

    const userMsg: ChatMessage = {
      id: generateMsgId('msg_user'),
      sender: 'user',
      text: messageText,
      timestamp: Date.now()
    };
    setChatMessages(prev => [...prev, userMsg]);

    if (activeMode === 'text') {
      // 100% Silent Text Mode: Route via server endpoint without audio context engagement
      clientRef.current?.ingestUserTranscript(messageText);

      if (textAbortControllerRef.current) {
        textAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      textAbortControllerRef.current = abortController;

      setIsTextGenerating(true);
      try {
        const res = await fetch('/api/voice/text-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageText,
            profile: buyerIntel.profile,
            history: [...chatMessages.slice(-5), userMsg]
          })
        });

        if (res.ok) {
          const data = await res.json();
          const reply = data.reply || data.message || '';
          if (reply) {
            setChatMessages(prev => [
              ...prev,
              {
                id: generateMsgId('msg_jessica'),
                sender: 'jessica',
                text: reply,
                timestamp: Date.now()
              }
            ]);
            clientRef.current?.ingestUserTranscript(reply);
          }
        } else {
          throw new Error(`Server returned ${res.status}`);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('[SalesDeskPage] Text chat request failed:', err);
        const p = buyerIntel.profile;
        let fallbackReply = '';
        if (p.vehicleType && p.monthlyBudget) {
          fallbackReply = `I have your ${p.vehicleType} preference and $${p.monthlyBudget}/month budget recorded in your priority file with Stephan! What is the best cell number so Stephan can text your private bank approval options?`;
        } else if (p.vehicleType) {
          fallbackReply = `Great choice on looking for a ${p.vehicleType}! What monthly payment range feels comfortable for your household budget?`;
        } else {
          fallbackReply = `I'm locking that into your priority file with Senior Allocation Specialist Stephan right now! What is your name and the best cell number to text your private vehicle matches?`;
        }
        setChatMessages(prev => [
          ...prev,
          {
            id: generateMsgId('msg_jessica'),
            sender: 'jessica',
            text: fallbackReply,
            timestamp: Date.now()
          }
        ]);
      } finally {
        if (textAbortControllerRef.current === abortController) {
          setIsTextGenerating(false);
          textAbortControllerRef.current = null;
        }
      }
    } else {
      if (!clientRef.current) return;
      GeminiLiveClient.unlockAudioContext().then(running => {
        if (running) setIsAudioUnlocked(true);
      });
      clientRef.current.sendTextMessage(messageText);
    }
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isTextGenerating) return;

    const userMsg: ChatMessage = {
      id: generateMsgId('msg_user'),
      sender: 'user',
      text: prompt,
      timestamp: Date.now()
    };
    setChatMessages(prev => [...prev, userMsg]);

    if (activeMode === 'text') {
      clientRef.current?.ingestUserTranscript(prompt);

      if (textAbortControllerRef.current) {
        textAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      textAbortControllerRef.current = abortController;

      setIsTextGenerating(true);
      try {
        const res = await fetch('/api/voice/text-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: prompt,
            profile: buyerIntel.profile,
            history: [...chatMessages.slice(-5), userMsg]
          })
        });

        if (res.ok) {
          const data = await res.json();
          const reply = data.reply || data.message || '';
          if (reply) {
            setChatMessages(prev => [
              ...prev,
              {
                id: generateMsgId('msg_jessica'),
                sender: 'jessica',
                text: reply,
                timestamp: Date.now()
              }
            ]);
            clientRef.current?.ingestUserTranscript(reply);
          }
        } else {
          throw new Error(`Server returned ${res.status}`);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('[SalesDeskPage] Quick prompt text chat request failed:', err);
        const p = buyerIntel.profile;
        let fallbackReply = '';
        if (p.vehicleType && p.monthlyBudget) {
          fallbackReply = `I have your ${p.vehicleType} preference and $${p.monthlyBudget}/month budget recorded in your priority file with Stephan! What is the best cell number so Stephan can text your private bank approval options?`;
        } else if (p.vehicleType) {
          fallbackReply = `Great choice on looking for a ${p.vehicleType}! What monthly payment range feels comfortable for your household budget?`;
        } else {
          fallbackReply = `I'm locking that into your priority file with Senior Allocation Specialist Stephan right now! What is your name and the best cell number to text your private vehicle matches?`;
        }
        setChatMessages(prev => [
          ...prev,
          {
            id: generateMsgId('msg_jessica'),
            sender: 'jessica',
            text: fallbackReply,
            timestamp: Date.now()
          }
        ]);
      } finally {
        if (textAbortControllerRef.current === abortController) {
          setIsTextGenerating(false);
          textAbortControllerRef.current = null;
        }
      }
    } else {
      if (!clientRef.current) return;
      GeminiLiveClient.unlockAudioContext().then(running => {
        if (running) setIsAudioUnlocked(true);
      });
      clientRef.current.sendTextMessage(prompt);
    }
  };

  const activeLevel = connectionState === 'SPEAKING' ? jarvisLevel : userLevel;
  const pulseScale = 1 + Math.min(activeLevel * 1.8, 0.45);

  const displayError =
    activeDiagnosticError ||
    errorMessage ||
    (connectionState === 'PROTOCOL_ERROR' ? 'Voice connection encountered a protocol error. Please restart.' : null);

  return (
    <div
      onClick={() => {
        if (activeMode === 'voice') {
          GeminiLiveClient.unlockAudioContext().then(running => {
            if (running) setIsAudioUnlocked(true);
          });
        }
      }}
      className="fixed inset-0 z-50 bg-[#050202] text-white flex flex-col justify-between p-2 sm:p-4 md:p-6 overflow-hidden select-none font-sans min-h-[100dvh] max-h-[100dvh] h-[100dvh]"
    >
      {/* High-Tech Background Holographic Environment */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse" />
        <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(214, 51, 36, 0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(214, 51, 36, 0.6) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      {/* Top HUD Header with Mode Toggle */}
      <header className="relative z-10 flex items-center justify-between border-b border-red-500/20 pb-3 sm:pb-4 gap-2">
        {/* Dealership & Sales Desk Title */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-950/60 border border-red-500/50 flex items-center justify-center shadow-[0_0_15px_rgba(214,51,36,0.35)] shrink-0">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
          </div>
          <div className="flex flex-col text-left min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="text-sm md:text-base font-bold tracking-widest text-white uppercase font-sans">
                SALES DESK
              </span>
              <span className="hidden sm:inline text-[9px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 font-bold uppercase tracking-wider">
                PERSONAL CONCIERGE
              </span>
            </div>
            <span className="text-[9px] sm:text-[10px] text-red-400/70 tracking-wider truncate">
              YOUR NEW AUTO // DIRECT LINE TO STEPHAN &amp; SALES TEAM
            </span>
          </div>
        </div>

        {/* Center Mode Switcher: Voice Mode (Default) vs Text Chat */}
        <div className="flex items-center bg-[#120404]/90 border border-red-500/40 rounded-xl p-0.5 shadow-lg">
          <button
            onClick={async () => {
              setActiveMode('voice');
              clientRef.current?.setAudioPlaybackSuppressed(false);
              const running = await GeminiLiveClient.unlockAudioContext();
              if (running) setIsAudioUnlocked(true);
            }}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeMode === 'voice'
                ? 'bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-[0_0_12px_rgba(214,51,36,0.4)]'
                : 'text-stone-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Radio className={`w-3 h-3 ${activeMode === 'voice' ? 'text-amber-300 animate-pulse' : ''}`} />
            <span>Voice</span>
          </button>

          <button
            onClick={() => {
              setActiveMode('text');
              clientRef.current?.abortActiveAudioPlayback();
              clientRef.current?.setAudioPlaybackSuppressed(true);
            }}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeMode === 'text'
                ? 'bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-[0_0_12px_rgba(214,51,36,0.4)]'
                : 'text-stone-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            <span>Text</span>
          </button>
        </div>

        {/* Status Indicator, Diagnostics & Disengage Button */}
        <div className="flex items-center gap-2 sm:gap-3 text-[11px] font-mono">
          {/* Telemetry / Diagnostics Button */}
          <button
            onClick={() => diagnosticStore.setHUDOpen(true)}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-500/30 hover:border-amber-400/60 hover:bg-red-900/50 text-amber-300 hover:text-amber-200 transition-all cursor-pointer group shadow-lg"
            title="Open System Diagnostics & Telemetry HUD"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400 group-hover:animate-pulse" />
            <span className="text-[10px] sm:text-[11px] tracking-wider uppercase font-bold hidden sm:inline">Telemetry</span>
          </button>

          {/* Screen Keep-Awake Indicator */}
          {isWakeLockActive && (
            <div 
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[9px] sm:text-[10px] font-mono tracking-wider uppercase shadow-[0_0_12px_rgba(245,158,11,0.2)]"
              title="Screen Keep-Awake Active: Mobile display will stay lit while using Jessica"
            >
              <Sun className="w-3 h-3 text-amber-400 animate-spin" style={{ animationDuration: '10s' }} />
              <span className="hidden xs:inline font-bold">Screen Awake</span>
            </div>
          )}

          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/40 border border-red-500/30">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionState === 'CONNECTED' || connectionState === 'LISTENING' || connectionState === 'SPEAKING'
                  ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]'
                  : 'bg-stone-600'
              }`}
            />
            <span className="text-red-200 uppercase tracking-widest text-[10px] font-bold">
              {connectionState === 'SPEAKING'
                ? 'JESSICA ADVISING'
                : connectionState === 'LISTENING'
                ? 'VOICE LINK ACTIVE'
                : connectionState === 'CONNECTING'
                ? 'CONNECTING'
                : connectionState === 'PROTOCOL_ERROR'
                ? 'RESTART REQUIRED'
                : 'OFFLINE'}
            </span>
          </div>

          {/* Restart / Clear Conversation Button */}
          <button
            onClick={handleRestartConversation}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-500/30 hover:border-amber-400/60 hover:bg-red-900/50 text-red-200 hover:text-amber-200 transition-all cursor-pointer group shadow-lg"
            title="Clear conversation & restart fresh"
          >
            <RotateCcw className="w-3.5 h-3.5 transition-transform group-hover:-rotate-90 text-amber-400" />
            <span className="text-[10px] sm:text-[11px] tracking-wider uppercase font-bold hidden sm:inline">Restart</span>
          </button>

          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-white/5 border border-red-500/30 hover:border-amber-400/60 hover:bg-red-950/40 text-white/80 hover:text-amber-200 transition-all cursor-pointer group shadow-lg"
            title="Close Sales Desk session"
          >
            <X className="w-4 h-4 transition-transform group-hover:rotate-90" />
            <span className="text-[10px] sm:text-[11px] tracking-wider uppercase font-bold hidden sm:inline">Exit</span>
          </button>
        </div>
      </header>

      {/* Persistent Error Banner (Above Standby, Voice, and Text modes) */}
      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="relative z-20 w-full max-w-4xl mx-auto my-1.5 px-3.5 py-2.5 rounded-xl bg-red-950/95 border border-red-500/70 shadow-[0_0_25px_rgba(214,51,36,0.4)] flex items-center justify-between gap-3 text-red-200 text-xs font-mono shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
              <span className="truncate font-semibold">{displayError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => diagnosticStore.setHUDOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-red-900/70 hover:bg-red-800 border border-red-500/50 text-amber-300 font-bold uppercase text-[10px] tracking-wider cursor-pointer transition-colors"
              >
                Diagnostics
              </button>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  diagnosticStore.clearActiveError();
                  if (connectionState === 'PROTOCOL_ERROR') {
                    handleRestartConversation();
                  } else {
                    clientRef.current?.connect();
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold uppercase text-[10px] tracking-wider cursor-pointer shadow-md transition-all"
              >
                Retry
              </button>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  diagnosticStore.clearActiveError();
                }}
                className="p-1 hover:bg-white/10 rounded text-stone-400 hover:text-white cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace: Voice View (Default) OR Text Chat View */}
      {activeMode === 'voice' ? (
        !isAudioUnlocked ? (
          /* STANDBY ACTIVATION INTERFACE (MOBILE AUTOPLAY & GESTURE SAFE) */
          <main className="relative z-10 flex-1 flex flex-col items-center justify-center my-auto p-4 max-w-lg mx-auto text-center">
            {/* Pulsing Arc Reactor */}
            <div className="relative w-28 h-28 sm:w-36 sm:h-36 flex items-center justify-center mb-5 shrink-0">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 20, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-2 border-dashed border-red-500/50 pointer-events-none"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}
                className="absolute inset-2 rounded-full border border-dotted border-amber-400/40 pointer-events-none"
              />
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-red-700 via-red-900 to-amber-600 flex items-center justify-center shadow-[0_0_40px_rgba(214,51,36,0.6)]">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-[#090303] border border-amber-400/40 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-amber-300 animate-pulse" />
                </div>
              </div>
            </div>

            {/* Status Pill */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/60 border border-red-500/40 mb-3 text-red-300 font-mono text-[10px] uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>VOICE SPECIALIST READY</span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-wider text-white uppercase font-sans mb-2">
              JESSICA SALES DESK
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 max-w-sm mx-auto mb-6 leading-relaxed">
              Connect directly with Jessica for real-time automotive advice, private bank approvals, and instant payment calculations.
            </p>

            {/* Authoritative Tap To Engage CTA Button */}
            <button
              onClick={handleActivateSalesDesk}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-red-600 via-red-500 to-amber-500 hover:from-red-500 hover:to-amber-400 text-white font-black text-xs sm:text-sm tracking-widest uppercase shadow-[0_0_35px_rgba(214,51,36,0.65)] hover:shadow-[0_0_45px_rgba(245,158,11,0.8)] flex items-center justify-center gap-3 transition-all cursor-pointer animate-pulse active:scale-95"
            >
              <PhoneCall className="w-5 h-5 text-amber-300 shrink-0" />
              <span>TAP TO ENGAGE SALES DESK // START CALL</span>
            </button>

            {/* Switch to Text Fallback */}
            <button
              onClick={() => {
                setActiveMode('text');
                GeminiLiveClient.unlockAudioContext().then(running => {
                  if (running) setIsAudioUnlocked(true);
                });
              }}
              className="text-stone-400 hover:text-amber-200 text-xs font-mono tracking-wider underline cursor-pointer mt-4"
            >
              Or continue in Text Mode (No Microphone Required)
            </button>
          </main>
        ) : (
          /* ACTIVE VOICE MODE VIEW */
          <main className="relative z-10 flex-1 flex flex-col items-center justify-center my-1 overflow-y-auto overflow-x-hidden">
            {/* Non-blocking Microphone Status Banner if mic is blocked */}
            {(micStatus === 'denied' || micStatus === 'unavailable') && (
              <div className="w-full max-w-xl mx-auto mb-2 px-3 py-2 rounded-xl bg-amber-950/80 border border-amber-500/50 flex items-center justify-between gap-2 text-xs text-amber-200 shrink-0 shadow-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">Microphone blocked. You can still hear Jessica and chat in Text Mode.</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={async () => {
                      if (clientRef.current) {
                        await clientRef.current.enableMicrophone();
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-black font-bold uppercase text-[10px] cursor-pointer"
                  >
                    Enable Mic
                  </button>
                  <button
                    onClick={() => setActiveMode('text')}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold uppercase text-[10px] cursor-pointer"
                  >
                    Text Mode
                  </button>
                </div>
              </div>
            )}

            {/* Protocol Error Recovery Banner (Section 2) */}
            {connectionState === 'PROTOCOL_ERROR' && (
              <div className="w-full max-w-md mx-auto my-2 p-3 sm:p-4 rounded-2xl bg-red-950/90 border border-red-500/60 shadow-[0_0_25px_rgba(214,51,36,0.35)] flex flex-col items-center gap-2.5 text-center">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs sm:text-sm">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
                  <span>Voice connection needs to be restarted.</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => initClientSession(false)}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-white font-bold text-xs uppercase tracking-wider shadow-lg cursor-pointer transition-all"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={() => setActiveMode('text')}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-stone-200 hover:text-white font-bold text-xs uppercase tracking-wider cursor-pointer transition-all"
                  >
                    Switch to Text
                  </button>
                </div>
              </div>
            )}

            {/* ── Central Voice Visualizer & Arc Reactor Holographic Centerpiece ── */}
            <div className="relative flex flex-col items-center justify-center my-auto w-full max-w-3xl py-3 sm:py-6 shrink-0">
              {/* Concentric Grand Radar Rings (The Big Circle) — 100% Centered on the Orb */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                {/* Outer 600px+ Grand Circle (The Big Circle) */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 60, ease: 'linear' }}
                  className="w-[340px] h-[340px] sm:w-[500px] sm:h-[500px] md:w-[580px] md:h-[580px] lg:w-[640px] lg:h-[640px] rounded-full border border-red-500/15 relative flex items-center justify-center"
                >
                  {/* Precision Compass Reticles */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-red-500/40" />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-red-500/40" />
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-red-500/40" />
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-red-500/40" />
                </motion.div>

                {/* Middle Cybernetic Dashed Orbit Ring */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 32, ease: 'linear' }}
                  className="absolute w-[250px] h-[250px] sm:w-[350px] sm:h-[350px] md:w-[410px] md:h-[410px] rounded-full border border-dashed border-red-500/25 flex items-center justify-center"
                />

                {/* Inner Radial Aura Glow */}
                <motion.div
                  animate={{
                    scale: connectionState === 'SPEAKING' ? [1, 1.15, 1] : [0.95, 1.05, 0.95],
                    opacity: connectionState === 'SPEAKING' ? [0.35, 0.65, 0.35] : [0.12, 0.22, 0.12]
                  }}
                  transition={{ repeat: Infinity, duration: connectionState === 'SPEAKING' ? 1.4 : 3, ease: 'easeInOut' }}
                  className="absolute w-[180px] h-[180px] sm:w-[260px] sm:h-[260px] rounded-full bg-gradient-to-tr from-red-600/30 via-amber-500/20 to-transparent blur-3xl pointer-events-none"
                />

                {/* Inner Dotted Accent Ring */}
                <div className="absolute w-[160px] h-[160px] sm:w-[220px] sm:h-[220px] rounded-full border border-dotted border-amber-500/30 pointer-events-none" />
              </div>

              {/* Arc Reactor Iris Orb (DEAD CENTER INSIDE THE BIG CIRCLE) */}
              <div className="relative z-10 flex items-center justify-center mb-3 sm:mb-4">
                <div className="relative w-22 h-22 sm:w-26 sm:h-26 md:w-30 md:h-30 flex items-center justify-center shrink-0">
                  {/* Outer Cybernetic Ring */}
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 20, ease: 'linear' }}
                    className="absolute inset-0 rounded-full border-2 border-dashed border-red-500/40 pointer-events-none"
                  />

                  {/* Middle Counter-Rotating Ring */}
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
                    className="absolute inset-1.5 rounded-full border border-dotted border-amber-400/35 pointer-events-none"
                  />

                  {/* Core Glow Aura */}
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1],
                      opacity: connectionState === 'SPEAKING' ? [0.7, 1, 0.7] : [0.35, 0.55, 0.35]
                    }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                    className="absolute inset-2 rounded-full bg-gradient-to-tr from-red-600/40 via-red-500/30 to-amber-500/30 blur-lg pointer-events-none"
                  />

                  {/* Central Iris Reactor Core */}
                  <motion.div
                    style={{
                      scale: pulseScale,
                      boxShadow:
                        connectionState === 'SPEAKING'
                          ? `0 0 35px rgba(245, 158, 11, 0.7), 0 0 70px rgba(214, 51, 36, 0.5)`
                          : connectionState === 'LISTENING' && userLevel > 0.015
                          ? `0 0 30px rgba(74, 222, 128, 0.6), 0 0 50px rgba(34, 197, 94, 0.3)`
                          : `0 0 20px rgba(214, 51, 36, 0.3)`
                    }}
                    transition={{ type: 'spring', damping: 15, stiffness: 200 }}
                    className={`w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-colors duration-300 ${
                      connectionState === 'SPEAKING'
                        ? 'bg-gradient-to-tr from-red-700 via-red-500 to-amber-500 ring-2 ring-amber-400/50'
                        : connectionState === 'LISTENING'
                        ? 'bg-gradient-to-tr from-stone-900 via-red-950 to-amber-900/60 border border-amber-500/50'
                        : connectionState === 'CONNECTING'
                        ? 'bg-gradient-to-tr from-stone-900 via-red-900 to-amber-600 animate-spin'
                        : connectionState === 'PROTOCOL_ERROR'
                        ? 'bg-gradient-to-tr from-stone-900 via-red-950 to-red-900 border border-amber-500/50'
                        : 'bg-gradient-to-tr from-stone-900 via-red-950 to-stone-900 border border-red-500/30'
                    }`}
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-[#080303]/90 border border-white/20 backdrop-blur-md flex flex-col items-center justify-center p-1 sm:p-2 text-center">
                      {connectionState === 'SPEAKING' ? (
                        <Volume2 className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300 animate-pulse" />
                      ) : connectionState === 'LISTENING' ? (
                        <Mic className={`w-5 h-5 sm:w-6 sm:h-6 text-amber-300 animate-pulse ${userLevel > 0.015 ? 'text-green-400' : ''}`} />
                      ) : connectionState === 'CONNECTING' ? (
                        <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300 animate-spin" />
                      ) : connectionState === 'PROTOCOL_ERROR' ? (
                        <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
                      ) : (
                        <Power className="w-5 h-5 sm:w-6 sm:h-6 text-red-500/40" />
                      )}
                    </div>
                  </motion.div>
                </div>
              </div>

              {/* Telemetry Status Banner */}
              <div className="relative z-10 flex flex-col items-center gap-2 shrink-0 mb-2">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#120404]/90 border border-red-500/40 backdrop-blur-md shadow-[0_0_15px_rgba(214,51,36,0.3)]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connectionState === 'SPEAKING'
                        ? 'bg-amber-400 animate-ping shadow-[0_0_8px_#f59e0b]'
                        : connectionState === 'LISTENING'
                        ? userLevel > 0.015 ? 'bg-green-400 animate-ping' : 'bg-red-500 animate-pulse'
                        : 'bg-stone-500'
                    }`}
                  />
                  <span className="text-[10px] sm:text-xs font-mono font-bold tracking-widest uppercase text-amber-200">
                    {connectionState === 'SPEAKING'
                      ? 'JESSICA IS ADVISING YOU...'
                      : connectionState === 'LISTENING'
                      ? userLevel > 0.015 ? 'DETECTING YOUR VOICE // SPEAKING...' : 'LISTENING TO YOU // CONVERSE FREELY'
                      : connectionState === 'CONNECTING'
                      ? 'ESTABLISHING 1:1 VOICE LINK...'
                      : connectionState === 'PROTOCOL_ERROR'
                      ? 'VOICE CONNECTION NEEDS TO BE RESTARTED'
                      : 'STANDBY // CLICK UNMUTE TO ENGAGE'}
                  </span>
                </div>

                {/* ── High-Tech Cybernetic 40-Bar Dynamic Frequency Spectrum Equalizer ── */}
                <div className="flex items-center justify-center gap-0.5 sm:gap-1 h-8 sm:h-10 md:h-12 px-3 py-1.5 rounded-xl bg-black/40 border border-red-500/20 backdrop-blur-md shadow-inner max-w-full">
                  {[...Array(40)].map((_, i) => {
                    // Symmetrical center-weighted Gaussian/Bell envelope
                    const centerNorm = Math.abs(i - 19.5) / 19.5;
                    const bellEnvelope = Math.max(0.2, 1 - Math.pow(centerNorm, 1.7) * 0.7);

                    let heightPct = 12;
                    if (connectionState === 'SPEAKING') {
                      const level = Math.max(0.1, jarvisLevel);
                      const harmonic1 = Math.sin(i * 0.48) * 0.35;
                      const harmonic2 = Math.cos(i * 0.88) * 0.25;
                      const harmonic3 = Math.sin(i * 1.45) * 0.15;
                      const dynamicMultiplier = Math.max(0.3, 0.65 + harmonic1 + harmonic2 + harmonic3);
                      heightPct = Math.min(100, Math.max(14, level * 150 * bellEnvelope * dynamicMultiplier));
                    } else if (connectionState === 'LISTENING') {
                      if (userLevel > 0.015) {
                        const harmonic1 = Math.sin(i * 0.52) * 0.35;
                        const harmonic2 = Math.cos(i * 1.05) * 0.25;
                        heightPct = Math.min(100, Math.max(14, userLevel * 180 * bellEnvelope * (0.7 + harmonic1 + harmonic2)));
                      } else {
                        // Ambient idle rhythm
                        const idleWave = Math.sin(i * 0.35) * 0.25;
                        heightPct = Math.max(10, 20 * bellEnvelope * (0.8 + idleWave));
                      }
                    } else if (connectionState === 'CONNECTING') {
                      const sweep = Math.sin(i * 0.25) * 0.4;
                      heightPct = Math.max(10, 30 * (0.6 + sweep));
                    }

                    return (
                      <div
                        key={i}
                        className={`w-0.5 sm:w-1 md:w-1.5 rounded-full transition-all duration-75 ${
                          connectionState === 'SPEAKING'
                            ? 'bg-gradient-to-t from-red-600 via-amber-500 to-amber-300 shadow-[0_0_5px_rgba(245,158,11,0.6)]'
                            : connectionState === 'LISTENING'
                            ? userLevel > 0.015
                              ? 'bg-gradient-to-t from-emerald-600 via-green-400 to-emerald-300 shadow-[0_0_5px_rgba(74,222,128,0.7)]'
                              : 'bg-gradient-to-t from-red-900/40 via-amber-800/40 to-amber-500/50'
                            : 'bg-stone-800/60'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tony Stark Holographic Blueprint Cards Deck (Docked Cleanly Below the Big Circle) */}
            <div className="relative z-10 w-full shrink-0 my-1">
              <JarvisBlueprintCards profile={buyerIntel.profile} metrics={buyerIntel.metrics} />
            </div>

            {/* Error notification alert */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mx-auto max-w-md px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/70 text-red-200 text-xs text-center font-mono shadow-xl flex items-center justify-between gap-3 mt-1"
                >
                  <span>{errorMessage}</span>
                  <button
                    onClick={() => initClientSession(true)}
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] uppercase cursor-pointer"
                  >
                    Retry
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        )
      ) : (
        /* TEXT CHAT MODE VIEW */
        <main className="relative z-10 flex-1 flex flex-col max-w-3xl w-full mx-auto my-1 overflow-hidden">
          {/* Compact Holographic Blueprint Strip */}
          <div className="shrink-0 mb-2">
            <JarvisBlueprintCards profile={buyerIntel.profile} metrics={buyerIntel.metrics} />
          </div>

          {/* Scrollable Message History */}
          <div 
            role="log"
            aria-live="polite"
            aria-atomic="false"
            className="flex-1 overflow-y-auto rounded-2xl bg-[#080303]/85 border border-red-500/30 p-3 sm:p-4 flex flex-col gap-3 shadow-inner"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-red-500/15 text-[9px] sm:text-[10px] text-red-400/70 uppercase tracking-widest font-mono">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Live Conversational History
              </span>
              {chatMessages.length > 0 && (
                <button
                  onClick={handleRestartConversation}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 border border-red-500/40 text-red-300 hover:text-amber-200 transition-all cursor-pointer text-[9px] font-bold"
                  title="Clear conversation and restart fresh"
                >
                  <RotateCcw className="w-2.5 h-2.5 text-amber-400" />
                  <span>Clear Convo</span>
                </button>
              )}
            </div>

            {chatMessages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-stone-400">
                <Sparkles className="w-8 h-8 text-amber-400/60 mb-2 animate-pulse" />
                <p className="text-sm font-semibold text-white">Sales Desk Chat Active</p>
                <p className="text-xs text-stone-400 max-w-sm mt-1">
                  Type your vehicle preference, target budget, or credit situation below. Jessica will instantly tailor
                  options and check private bank approvals with Stephan.
                </p>
              </div>
            ) : (
              chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%] ${
                    msg.sender === 'user' ? 'self-end flex-row-reverse' : 'self-start'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.sender === 'user'
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                        : 'bg-red-950/60 border border-red-500/50 text-red-300'
                    }`}
                  >
                    {msg.sender === 'user' ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  </div>

                  <div
                    className={`rounded-2xl px-3.5 py-2 text-xs sm:text-sm leading-relaxed shadow-md ${
                      msg.sender === 'user'
                        ? 'bg-gradient-to-r from-amber-600/90 to-amber-700/90 text-white rounded-tr-none'
                        : 'bg-[#140505] border border-red-500/40 text-stone-100 rounded-tl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))
            )}
            {isTextGenerating && (
              <div className="flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%] self-start animate-pulse">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-red-950/60 border border-red-500/50 text-amber-400">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="rounded-2xl px-4 py-2.5 bg-[#140505] border border-red-500/40 text-stone-300 text-xs rounded-tl-none flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-amber-300/80">Jessica is replying...</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Quick Choice Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-2 scrollbar-hide text-[10px] sm:text-xs">
            {[
              "I'm looking for a car",
              "I'm looking for an SUV",
              'I need a truck',
              'I need a van',
              'Around $500 / month',
              'Rebuilding my credit',
              'Zero down payment'
            ].map((chip, idx) => (
              <button
                key={idx}
                disabled={isTextGenerating}
                onClick={() => handleQuickPrompt(chip)}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-red-950/40 border border-red-500/30 hover:border-amber-400/60 text-stone-300 hover:text-amber-200 whitespace-nowrap transition-all cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSendTextMessage} className="flex items-center gap-2 mt-1">
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              disabled={isTextGenerating}
              placeholder={isTextGenerating ? "Jessica is drafting response..." : "Ask Jessica about vehicles, payments, or private approvals..."}
              className="flex-1 bg-[#0a0404] border border-red-500/40 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-stone-500 focus:outline-none shadow-lg disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || isTextGenerating}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all shadow-[0_0_12px_rgba(214,51,36,0.3)] flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </main>
      )}

      {/* Bottom HUD Footer (Tactile Controls) */}
      <footer className="relative z-10 w-full max-w-3xl mx-auto flex flex-col items-center justify-center shrink-0 pt-1 pb-1 sm:pb-2">
        {/* Bottom Tactile Action Buttons */}
        <div className="flex items-center justify-center gap-2.5 sm:gap-4 py-1 flex-wrap">
          {activeMode === 'voice' && (
            <button
              onClick={handleToggleMute}
              disabled={connectionState !== 'LISTENING' && connectionState !== 'SPEAKING'}
              className={`flex items-center gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-2xl border transition-all cursor-pointer text-xs font-bold uppercase tracking-wider shadow-lg ${
                isMuted
                  ? 'bg-yellow-950/80 border-yellow-500/60 text-yellow-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'bg-red-950/80 border-red-500/50 hover:border-amber-400 text-red-200 hover:text-amber-200 hover:bg-red-900/60 shadow-[0_0_15px_rgba(214,51,36,0.3)]'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4 text-yellow-400" /> : <Mic className="w-4 h-4 text-amber-400" />}
              <span>{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>
          )}

          {/* Clear & Restart Conversation Button */}
          <button
            onClick={handleRestartConversation}
            className="flex items-center gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-2xl border border-red-500/40 bg-red-950/40 hover:bg-red-900/60 hover:border-amber-400 text-red-200 hover:text-amber-200 transition-all cursor-pointer text-xs font-bold uppercase tracking-wider shadow-lg group"
            title="Clear conversation and restart from the beginning"
          >
            <RotateCcw className="w-4 h-4 text-amber-400 transition-transform group-hover:-rotate-90" />
            <span>Restart</span>
          </button>

          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-2xl border border-white/15 bg-white/5 hover:border-red-500/60 hover:bg-red-950/40 text-white/70 hover:text-white transition-all cursor-pointer text-xs font-bold uppercase tracking-wider"
          >
            <Power className="w-4 h-4" />
            <span>End Session</span>
          </button>
        </div>
      </footer>

      {/* Real-time System Diagnostics & Telemetry HUD Drawer */}
      <DiagnosticHUD />
    </div>
  );
}
