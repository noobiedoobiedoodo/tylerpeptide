import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, RotateCcw, Download, Sparkles, Volume2, VolumeX, 
  Smartphone, Monitor, Zap, PhoneCall
} from 'lucide-react';
import { soundtrackEngine } from './videoSoundtrack';

const TOTAL_DURATION = 8.0; // 8.00 seconds strict runtime

interface JessicaPromoVideoStudioProps {
  onClose?: () => void;
  onLaunchJessica?: () => void;
}

/**
 * Aspect-Ratio Preserving Cover Draw
 * Ensures cars and graphics maintain natural proportions in both 9:16 and 16:9
 */
function drawCoverImage(
  ctx: CanvasRenderingContext2D, 
  img: HTMLImageElement, 
  canvasW: number, 
  canvasH: number, 
  zoom: number = 1.0
) {
  const imgRatio = img.width / img.height;
  const canvasRatio = canvasW / canvasH;
  let renderW: number;
  let renderH: number;

  if (canvasRatio > imgRatio) {
    renderW = canvasW * zoom;
    renderH = (canvasW / imgRatio) * zoom;
  } else {
    renderH = canvasH * zoom;
    renderW = (canvasH * imgRatio) * zoom;
  }

  const offsetX = (canvasW - renderW) / 2;
  const offsetY = (canvasH - renderH) / 2;

  ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
}

export function JessicaPromoVideoStudio({ onClose, onLaunchJessica }: JessicaPromoVideoStudioProps) {
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Cached hero graphics
  const imagesRef = useRef<{
    cockpit: HTMLImageElement | null;
    truck: HTMLImageElement | null;
    cta: HTMLImageElement | null;
  }>({ cockpit: null, truck: null, cta: null });

  // Preload assets
  useEffect(() => {
    const img1 = new Image();
    img1.src = '/creatives/jessica_promo_hero.jpg';
    img1.onload = () => { imagesRef.current.cockpit = img1; };

    const img2 = new Image();
    img2.src = '/creatives/truck_preapproval_hero.jpg';
    img2.onload = () => { imagesRef.current.truck = img2; };

    const img3 = new Image();
    img3.src = '/creatives/jessica_cta_hero.jpg';
    img3.onload = () => { imagesRef.current.cta = img3; };

    soundtrackEngine.preloadAssets().catch(console.warn);
  }, []);

  useEffect(() => {
    soundtrackEngine.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  /**
   * Main High-Octane Canvas Drawing Pipeline
   */
  const renderFrame = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    ctx.clearRect(0, 0, width, height);

    // Subtle camera shake on bass impacts
    let shakeX = 0;
    let shakeY = 0;
    const shakePoints = [0.0, 3.1, 6.2];
    for (const sp of shakePoints) {
      if (time >= sp && time <= sp + 0.35) {
        const decay = 1 - (time - sp) / 0.35;
        shakeX = (Math.random() - 0.5) * 10 * decay;
        shakeY = (Math.random() - 0.5) * 10 * decay;
        break;
      }
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    const cx = width / 2;
    const cy = height / 2;

    // ── BEAT 1: 0.0s – 1.8s (THE HOOK / 188 KM/H REDLINE) ──
    if (time < 1.8) {
      const p = time / 1.8;
      ctx.fillStyle = '#050202';
      ctx.fillRect(0, 0, width, height);

      // Speed perspective streaks
      ctx.strokeStyle = 'rgba(214, 51, 36, 0.4)';
      ctx.lineWidth = 2.5;
      const numLines = 24;
      for (let i = 0; i < numLines; i++) {
        const angle = (i / numLines) * Math.PI * 2 + time * 1.5;
        const dist = 60 + ((i * 41 + time * 1400) % (Math.max(width, height) * 0.85));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * (dist * 0.65), cy + Math.sin(angle) * (dist * 0.65));
        ctx.lineTo(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
        ctx.stroke();
      }

      // Digital Tachometer Dial
      const rpm = Math.min(1.0, p * 1.25);
      const dialRadius = Math.min(width, height) * 0.26;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, dialRadius, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

      const grad = ctx.createLinearGradient(cx - 100, cy, cx + 100, cy);
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(1, '#ef4444');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, dialRadius, Math.PI * 0.75, Math.PI * 0.75 + rpm * Math.PI * 1.5);
      ctx.stroke();

      // Readout
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.floor(width * 0.1)}px 'Arial Black', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const speedVal = Math.floor(rpm * 188);
      ctx.fillText(`${speedVal}`, cx, cy - 15);

      ctx.font = `700 ${Math.floor(width * 0.032)}px monospace`;
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`KM/H // REDLINE BOOST`, cx, cy + 32);

      // Kinetic typography: "STOP SCROLLING"
      const textScale = Math.max(1.0, 1.6 - p * 1.0);
      ctx.save();
      ctx.translate(cx, height * 0.18);
      ctx.scale(textScale, textScale);
      ctx.font = `900 ${Math.floor(width * 0.1)}px 'Arial Black', sans-serif`;
      ctx.fillStyle = '#ff2222';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 25;
      ctx.fillText('STOP SCROLLING.', 0, 0);
      ctx.restore();

      // Subtitle
      if (time > 0.3) {
        ctx.font = `800 ${Math.floor(width * 0.042)}px sans-serif`;
        ctx.fillStyle = '#fef08a';
        ctx.fillText('NEED A CAR WITH ZERO DOWN?', cx, height * 0.82);
      }
    }

    // ── BEAT 2: 1.8s – 4.2s (MEET JESSICA / AI COCKPIT) ──
    else if (time >= 1.8 && time < 4.2) {
      const p = (time - 1.8) / 2.4;
      const zoom = 1.0 + p * 0.06;

      if (imagesRef.current.cockpit) {
        drawCoverImage(ctx, imagesRef.current.cockpit, width, height, zoom);
      } else {
        ctx.fillStyle = '#080202';
        ctx.fillRect(0, 0, width, height);
      }

      // Soft vignette for readability without hiding the 3D cockpit
      const vig = ctx.createLinearGradient(0, 0, 0, height);
      vig.addColorStop(0, 'rgba(5, 2, 2, 0.7)');
      vig.addColorStop(0.3, 'rgba(5, 2, 2, 0.1)');
      vig.addColorStop(0.7, 'rgba(5, 2, 2, 0.15)');
      vig.addColorStop(1, 'rgba(5, 2, 2, 0.8)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      // Top Header: "MEET JESSICA"
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.floor(width * 0.11)}px 'Arial Black', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 24;
      ctx.fillText('MEET JESSICA.', cx, height * 0.14);
      ctx.shadowBlur = 0;

      // Clean, sleek pill badge at bottom
      const pillW = width * 0.76;
      const pillH = height * 0.05;
      ctx.fillStyle = 'rgba(214, 51, 36, 0.75)';
      ctx.beginPath();
      ctx.roundRect(cx - pillW / 2, height * 0.84, pillW, pillH, 12);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `800 ${Math.floor(width * 0.036)}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('24/7 AI PERSONAL CAR DEALMAKER', cx, height * 0.84 + pillH * 0.65);
    }

    // ── BEAT 3: 4.2s – 6.2s (THE MATCH: 4X4 TRUCK // $380/MO ZERO DOWN) ──
    else if (time >= 4.2 && time < 6.2) {
      const p = (time - 4.2) / 2.0;
      const zoom = 1.02 + p * 0.05;

      if (imagesRef.current.truck) {
        drawCoverImage(ctx, imagesRef.current.truck, width, height, zoom);
      } else {
        ctx.fillStyle = '#060303';
        ctx.fillRect(0, 0, width, height);
      }

      // Soft vignette
      const vig = ctx.createLinearGradient(0, 0, 0, height);
      vig.addColorStop(0, 'rgba(5, 2, 2, 0.7)');
      vig.addColorStop(0.3, 'rgba(5, 2, 2, 0.05)');
      vig.addColorStop(0.8, 'rgba(5, 2, 2, 0.2)');
      vig.addColorStop(1, 'rgba(5, 2, 2, 0.85)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      // Top Badge
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.floor(width * 0.08)}px 'Arial Black', sans-serif`;
      ctx.fillStyle = '#10b981';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 25;
      ctx.fillText('100% PRE-APPROVED', cx, height * 0.13);
      ctx.shadowBlur = 0;

      // Bottom sleek banner
      ctx.font = `800 ${Math.floor(width * 0.045)}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ALL CREDIT SITUATIONS WELCOME', cx, height * 0.88);
    }

    // ── BEAT 4: 6.2s – 8.0s (HYPER CTA: TALK TO JESSICA NOW) ──
    else {
      const p = (time - 6.2) / 1.8;
      const zoom = 1.0 + p * 0.04;

      if (imagesRef.current.cta) {
        drawCoverImage(ctx, imagesRef.current.cta, width, height, zoom);
      } else {
        ctx.fillStyle = '#050202';
        ctx.fillRect(0, 0, width, height);
      }

      // Vignette
      const vig = ctx.createLinearGradient(0, 0, 0, height);
      vig.addColorStop(0, 'rgba(5, 2, 2, 0.75)');
      vig.addColorStop(0.4, 'rgba(5, 2, 2, 0.1)');
      vig.addColorStop(0.7, 'rgba(5, 2, 2, 0.3)');
      vig.addColorStop(1, 'rgba(5, 2, 2, 0.9)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      // Expanding Shockwave rings around center
      const ringRadius = (time - 6.2) * Math.max(width, height) * 0.7;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius % (Math.max(width, height) * 0.65), 0, Math.PI * 2);
      ctx.stroke();

      // Top Website Branding
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.floor(width * 0.075)}px 'Arial Black', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 20;
      ctx.fillText('YOURNEWAUTO.CA', cx, height * 0.12);
      ctx.shadowBlur = 0;

      // Bottom Sleek Action Bar
      const btnW = width * 0.86;
      const btnH = height * 0.1;
      const btnY = height * 0.78;

      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 35;
      const btnGrad = ctx.createLinearGradient(cx - btnW / 2, btnY, cx + btnW / 2, btnY + btnH);
      btnGrad.addColorStop(0, '#dc2626');
      btnGrad.addColorStop(0.5, '#ef4444');
      btnGrad.addColorStop(1, '#f59e0b');
      ctx.fillStyle = btnGrad;
      ctx.beginPath();
      ctx.roundRect(cx - btnW / 2, btnY, btnW, btnH, 18);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // CTA Text
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.floor(width * 0.058)}px 'Arial Black', sans-serif`;
      ctx.fillText('TALK TO JESSICA NOW', cx, btnY + btnH * 0.45);

      ctx.font = `800 ${Math.floor(width * 0.032)}px monospace`;
      ctx.fillStyle = '#fef08a';
      ctx.fillText('▶ TAP TO START YOUR APPROVAL', cx, btnY + btnH * 0.76);
    }

    // High-tech CRT scanline accents
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    for (let y = 0; y < height; y += 4) {
      ctx.fillRect(0, y, width, 1.5);
    }

    // Timecode stamp HUD
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.floor(width * 0.028)}px monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(`0${time.toFixed(2)}s / 08.00s [60 FPS]`, width - 16, 26);

    ctx.restore();
  }, []);

  /**
   * Main 60 FPS Animation Loop
   */
  useEffect(() => {
    let animId: number;

    const tick = (timestamp: number) => {
      if (!lastTimestampRef.current) lastTimestampRef.current = timestamp;
      const delta = (timestamp - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = timestamp;

      if (isPlaying) {
        let nextTime = currentTimeRef.current + delta;
        if (nextTime >= TOTAL_DURATION) {
          nextTime = 0;
          soundtrackEngine.playFullScore();
        }
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderFrame(ctx, canvas.width, canvas.height, currentTimeRef.current);
        }
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, renderFrame]);

  const togglePlay = () => {
    if (!isPlaying) {
      if (currentTime >= TOTAL_DURATION - 0.1) {
        setCurrentTime(0);
        currentTimeRef.current = 0;
      }
      soundtrackEngine.playFullScore();
      setIsPlaying(true);
    } else {
      soundtrackEngine.stopAll();
      setIsPlaying(false);
    }
  };

  const handleReset = () => {
    soundtrackEngine.stopAll();
    setCurrentTime(0);
    currentTimeRef.current = 0;
    if (isPlaying) {
      soundtrackEngine.playFullScore();
    }
  };

  /**
   * 1-Click Video Exporter (.webm / .mp4)
   */
  const handleExportVideo = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsExporting(true);
    setExportProgress(0);
    setIsPlaying(false);
    soundtrackEngine.stopAll();

    const stream = canvas.captureStream(60);
    const audioTrack = soundtrackEngine.getAudioStream();
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000
    });
    mediaRecorderRef.current = recorder;
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jessica_8s_high_octane_demo_${aspectRatio === '9:16' ? 'vertical' : 'landscape'}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setIsExporting(false);
      setExportProgress(100);
    };

    currentTimeRef.current = 0;
    setCurrentTime(0);
    soundtrackEngine.playFullScore();
    recorder.start();

    const startTime = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      currentTimeRef.current = Math.min(TOTAL_DURATION, elapsed);
      setCurrentTime(currentTimeRef.current);
      setExportProgress(Math.floor((elapsed / TOTAL_DURATION) * 100));

      if (elapsed >= TOTAL_DURATION) {
        clearInterval(interval);
        recorder.stop();
        soundtrackEngine.stopAll();
      }
    }, 16.6);
  };

  const canvasWidth = aspectRatio === '9:16' ? 720 : 1280;
  const canvasHeight = aspectRatio === '9:16' ? 1280 : 720;

  return (
    <div className="fixed inset-0 z-[100] bg-[#040101] text-white flex flex-col md:flex-row overflow-hidden select-none font-sans">
      {/* Left Column: Video Stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-6 bg-gradient-to-b from-[#080202] to-[#020101] relative">
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-950/60 border border-red-500/40 text-xs font-mono">
            <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span className="text-amber-300 font-bold uppercase">Jessica 8S High-Octane Reel</span>
          </div>
        </div>

        <div 
          className="relative rounded-2xl overflow-hidden border-2 border-red-500/40 shadow-[0_0_50px_rgba(214,51,36,0.35)] bg-black max-h-[72vh] flex items-center justify-center"
          style={{
            aspectRatio: aspectRatio === '9:16' ? '9 / 16' : '16 / 9',
            maxWidth: aspectRatio === '9:16' ? '420px' : '900px',
            width: '100%'
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="w-full h-full object-contain cursor-pointer"
            onClick={togglePlay}
          />

          {isExporting && (
            <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-20">
              <div className="w-16 h-16 rounded-full border-4 border-amber-500/30 border-t-amber-400 animate-spin" />
              <div className="text-center">
                <span className="text-sm font-black tracking-widest text-amber-300 uppercase font-mono">
                  RECORDING 60 FPS VIDEO: {exportProgress}%
                </span>
                <p className="text-xs text-stone-400 mt-1">Baking studio audio master &amp; visuals...</p>
              </div>
            </div>
          )}
        </div>

        {/* Timeline Bar */}
        <div className="w-full max-w-xl mt-4 px-4 py-3 rounded-2xl bg-[#0e0404]/90 border border-red-500/30 shadow-xl flex flex-col gap-2">
          <div 
            className="w-full h-2 rounded-full bg-stone-800 cursor-pointer relative overflow-hidden group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const newTime = ratio * TOTAL_DURATION;
              setCurrentTime(newTime);
              currentTimeRef.current = newTime;
            }}
          >
            <div 
              className="h-full bg-gradient-to-r from-red-600 via-amber-500 to-amber-300 rounded-full"
              style={{ width: `${(currentTime / TOTAL_DURATION) * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlay}
                className="w-8 h-8 rounded-xl bg-gradient-to-r from-red-600 to-amber-500 flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play (8s)'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>

              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-stone-300 hover:text-white transition-all cursor-pointer"
                title="Rewind"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => setIsMuted(!isMuted)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-stone-300 hover:text-white transition-all cursor-pointer"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
              </button>

              <span className="text-stone-300 font-bold ml-1">
                0{currentTime.toFixed(2)}s <span className="text-stone-500">/ 08.00s</span>
              </span>
            </div>

            <span className="text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-red-950/70 border border-red-500/40 text-amber-300 font-bold">
              {currentTime < 1.8 ? 'REDLINE HOOK' : currentTime < 4.2 ? 'MEET JESSICA' : currentTime < 6.2 ? 'TRUCK PRE-APPROVAL' : 'HYPER CTA'}
            </span>
          </div>
        </div>
      </div>

      {/* Right Column: Studio Controls */}
      <div className="w-full md:w-96 p-4 sm:p-6 bg-[#090303] border-t md:border-t-0 md:border-l border-red-500/20 flex flex-col justify-between overflow-y-auto">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-red-500/20">
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-widest text-white uppercase font-sans">
                VIDEO STUDIO
              </h2>
              <p className="text-[10px] text-red-400/80 font-mono tracking-wider">
                COMMERCIAL MASTER // ZERO OVERLAP
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-mono text-stone-300 cursor-pointer"
              >
                Close
              </button>
            )}
          </div>

          {/* Aspect Ratio Format */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-400 font-mono">
              Aspect Ratio Format
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold uppercase tracking-wider cursor-pointer transition-all ${
                  aspectRatio === '9:16'
                    ? 'bg-gradient-to-r from-red-600 to-amber-600 border-amber-400 text-white shadow-[0_0_15px_rgba(214,51,36,0.5)]'
                    : 'bg-white/5 border-white/10 text-stone-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>9:16 Reels / TikTok</span>
              </button>

              <button
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold uppercase tracking-wider cursor-pointer transition-all ${
                  aspectRatio === '16:9'
                    ? 'bg-gradient-to-r from-red-600 to-amber-600 border-amber-400 text-white shadow-[0_0_15px_rgba(214,51,36,0.5)]'
                    : 'bg-white/5 border-white/10 text-stone-400 hover:text-white'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>16:9 YouTube / Web</span>
              </button>
            </div>
          </div>

          {/* Export Video */}
          <button
            onClick={handleExportVideo}
            disabled={isExporting}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-red-600 to-amber-500 hover:from-amber-400 hover:to-red-500 text-white font-black text-xs sm:text-sm tracking-widest uppercase shadow-[0_0_25px_rgba(245,158,11,0.5)] flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 transition-all active:scale-95"
          >
            <Download className="w-4 h-4 text-amber-200" />
            <span>EXPORT 8S VIDEO (MP4/WEBM)</span>
          </button>

          {/* Clean Commercial Timeline Blueprint */}
          <div className="flex flex-col gap-2 bg-black/40 p-3 rounded-xl border border-red-500/20">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 font-mono">
              Commercial Audio-Visual Timeline
            </span>
            <div className="space-y-2 text-[11px] text-stone-300 font-mono">
              <div className="border-b border-white/5 pb-1.5">
                <div className="flex justify-between text-red-400 font-bold">
                  <span>0.0s – 1.8s</span>
                  <span>REDLINE HOOK</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  V8 Throttle Roar + 188 KM/H Tachometer
                </div>
              </div>

              <div className="border-b border-white/5 pb-1.5">
                <div className="flex justify-between text-amber-400 font-bold">
                  <span>1.8s – 4.2s</span>
                  <span>MEET JESSICA</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Voice Line 1: &quot;Need a car with zero down? Meet Jessica.&quot;
                </div>
              </div>

              <div className="border-b border-white/5 pb-1.5">
                <div className="flex justify-between text-green-400 font-bold">
                  <span>4.2s – 6.2s</span>
                  <span>PRE-APPROVAL</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Turbo Flutter + Drifting Ford Raptor ($380/mo)
                </div>
              </div>

              <div>
                <div className="flex justify-between text-yellow-400 font-bold">
                  <span>6.2s – 8.0s</span>
                  <span>HYPER CTA</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Voice Line 2: &quot;Get pre-approved in seconds. Tap to speak!&quot;
                </div>
              </div>
            </div>
          </div>

          {/* Audio Master Quality Card */}
          <div className="flex flex-col gap-1.5 bg-red-950/30 p-3 rounded-xl border border-amber-500/30 font-mono text-[11px]">
            <div className="flex items-center gap-1.5 text-amber-300 font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Clean Broadcast Master</span>
            </div>
            <div className="text-[10px] text-stone-300 space-y-1">
              <p>• <span className="text-amber-200 font-bold">Zero Overlap:</span> 2 distinct phrases with clean SFX breathing room.</p>
              <p>• <span className="text-amber-200 font-bold">Proportions:</span> Aspect-cover scaling prevents pancaking in 16:9.</p>
              <p>• <span className="text-amber-200 font-bold">No Clutter:</span> Native 3D artwork shines without opaque box overlays.</p>
            </div>
          </div>
        </div>

        {/* Live Jessica Call Button */}
        <div className="pt-4 mt-4 border-t border-red-500/20 flex flex-col gap-2">
          <button
            onClick={() => {
              if (onLaunchJessica) {
                onLaunchJessica();
              } else if (onClose) {
                onClose();
              }
            }}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <PhoneCall className="w-4 h-4 text-amber-300" />
            <span>TALK TO JESSICA LIVE NOW</span>
          </button>
        </div>
      </div>
    </div>
  );
}
