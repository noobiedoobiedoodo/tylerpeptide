/**
 * client/src/components/EvidenceFrameworkGuide.tsx
 * 
 * Visual Reference Guide for the 5-Tier Evidence Classification & Safety Framework.
 * Formulates the mandatory clinical rules for Levels A–E, non-prescribing boundaries,
 * adverse effect categorization, and emergent triage.
 */

import React from 'react';
import { 
  ShieldCheck, AlertTriangle, Scale, Stethoscope, 
  HelpCircle, CheckCircle2, ArrowRight, ShieldAlert, BookOpen
} from 'lucide-react';
import { EvidenceBadge } from './PeptideVoicePage';

export function EvidenceFrameworkGuide() {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#06080d] text-zinc-100 max-w-5xl mx-auto w-full space-y-8">
      
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Scale className="w-6 h-6 text-emerald-400" />
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Peptide Evidence & Safety Framework
          </h1>
        </div>
        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-3xl">
          The single core purpose of this voice agent is informing users with transparent, rigorous evidence distinction. 
          Anecdotal reports must never become clinical claims, and preclinical findings must never be conflated with human proof.
        </p>
      </div>

      {/* ── MANDATORY 5-TIER EVIDENCE HIERARCHY ───────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> 1. The Mandatory 5-Tier Evidence Classification
        </h2>

        <div className="grid grid-cols-1 gap-3.5">
          
          {/* LEVEL A */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-emerald-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <EvidenceBadge level="LEVEL_A" />
              <span className="text-[11px] font-mono text-emerald-400 font-bold">Highest Scientific Rigor</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Evidence supported by human clinical research, randomized controlled trials (RCTs), systematic reviews, meta-analyses, and established regulatory approvals (e.g. FDA-approved indications for Semaglutide, Tirzepatide, or Tesamorelin in HIV lipodystrophy).
            </p>
            <div className="p-2.5 rounded-lg bg-black/50 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="text-emerald-400 font-bold">Agent Voice Standard:</span> "There is clinical evidence supporting..." or "Human clinical research has found..."
            </div>
          </div>

          {/* LEVEL B */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <EvidenceBadge level="LEVEL_B" />
              <span className="text-[11px] font-mono text-cyan-400 font-bold">Preliminary Human Research</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Human clinical research exists, but the evidence is limited, preliminary, inconsistent, small-cohort, or insufficient to establish a proven clinical benefit (e.g. CJC-1295 GH pulsatility studies, Hexarelin cardiac ischemia trials, or Follistatin gene therapy in Becker muscular dystrophy).
            </p>
            <div className="p-2.5 rounded-lg bg-black/50 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="text-cyan-400 font-bold">Agent Voice Standard:</span> "There is some human research, but the evidence is still limited."
            </div>
          </div>

          {/* LEVEL C */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <EvidenceBadge level="LEVEL_C" />
              <span className="text-[11px] font-mono text-amber-400 font-bold">Preclinical & Experimental</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Evidence comes exclusively from laboratory research, in vitro cell studies, animal models (rodents, mice), and mechanistic hypotheses (e.g. BPC-157 tendon repair in rats, TB-500 animal wound repair, MOTS-c AMPK activation).
            </p>
            <div className="p-2.5 rounded-lg bg-black/50 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="text-amber-400 font-bold">Mandatory Explicit Warning:</span> "This has been investigated in preclinical research, but that doesn't establish the same effect in humans."
            </div>
          </div>

          {/* LEVEL D */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-purple-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <EvidenceBadge level="LEVEL_D" />
              <span className="text-[11px] font-mono text-purple-400 font-bold">Uncontrolled Community Reports</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Individual experiences, bodybuilder forum discussions, gym testimonials, practitioner anecdotes, and online biohacking claims. NEVER convert anecdotal reports into clinical claims.
            </p>
            <div className="p-2.5 rounded-lg bg-black/50 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="text-purple-400 font-bold">Agent Voice Standard:</span> "Some people report experiencing this, but that's anecdotal evidence rather than clinical evidence."
            </div>
          </div>

          {/* LEVEL E */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-700 space-y-2">
            <div className="flex items-center justify-between">
              <EvidenceBadge level="LEVEL_E" />
              <span className="text-[11px] font-mono text-zinc-400 font-bold">Unknown / Insufficient</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              When reliable evidence cannot establish the answer, the agent must never hallucinate. The agent is strictly permitted to say "we don't know."
            </p>
            <div className="p-2.5 rounded-lg bg-black/50 border border-zinc-800 text-[11px] font-mono text-zinc-300">
              <span className="text-zinc-400 font-bold">Agent Voice Standard:</span> "There isn't enough reliable evidence to say that this benefit is established."
            </div>
          </div>

        </div>
      </div>

      {/* ── THE IRON LAW: NEVER BLUR EVIDENCE CATEGORIES ──────────────────── */}
      <div className="p-5 rounded-2xl bg-rose-950/20 border border-rose-900/40 space-y-3">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> 2. The Iron Law: Never Blur Evidence Categories
        </h3>
        <p className="text-xs text-zinc-300 leading-relaxed">
          The following progression is strictly prohibited in this build:
        </p>
        <div className="p-3 rounded-xl bg-black/60 border border-rose-950 text-xs font-mono text-rose-300/90 flex flex-wrap items-center gap-2">
          <span>Animal study</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
          <span>Mechanism discovered</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
          <span>People online report benefits</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
          <span className="text-rose-400 font-bold underline">PROHIBITED: AI states peptide provides benefit</span>
        </div>
        <p className="text-xs text-zinc-300">
          The agent must preserve: <span className="font-mono text-emerald-400">Clinical evidence</span> ≠ <span className="font-mono text-amber-400">Preclinical research</span> ≠ <span className="font-mono text-cyan-400">Mechanistic theory</span> ≠ <span className="font-mono text-purple-400">Anecdotal experience</span>.
        </p>
      </div>

      {/* ── BENEFIT & SYMPTOM STRUCTURES ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
          <h3 className="text-xs font-mono font-bold uppercase text-white tracking-wider flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400" /> Benefit Question Structure
          </h3>
          <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside font-mono">
            <li>What the peptide is</li>
            <li>What it has been studied for</li>
            <li>Evidence level (Clinical / Preclinical / Anecdotal)</li>
            <li>What the evidence actually demonstrates</li>
            <li>Limitations and uncertainties</li>
            <li>Known safety considerations</li>
          </ol>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
          <h3 className="text-xs font-mono font-bold uppercase text-white tracking-wider flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-amber-400" /> Side-Effect Categorization
          </h3>
          <ul className="text-xs text-zinc-400 space-y-1 font-mono">
            <li><strong className="text-zinc-200">Established:</strong> Supported by clinical safety trials / label inserts</li>
            <li><strong className="text-zinc-200">Reported:</strong> Observed in studies with limited certainty</li>
            <li><strong className="text-zinc-200">Anecdotal:</strong> Community reports without causation</li>
            <li><strong className="text-zinc-200">Unknown:</strong> Insufficient reliable evidence</li>
          </ul>
        </div>

      </div>

      {/* ── CLINICAL SAFETY ESCALATION & NON-PRESCRIBING BOUNDARIES ──────── */}
      <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> 3. Clinical Safety Escalation & Non-Prescribing Boundaries
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-300">
          <div className="p-3 rounded-xl bg-black/40 border border-zinc-800 space-y-1.5">
            <div className="font-bold text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-rose-400" /> Emergent Symptoms Protocol
            </div>
            <p className="text-zinc-400 leading-relaxed">
              If user mentions chest pain, shortness of breath, anaphylaxis, severe hypoglycemia, severe abdominal pain, or rapidly worsening symptoms: Agent must immediately trigger safety escalation without attempting a diagnosis.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-zinc-800 space-y-1.5">
            <div className="font-bold text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" /> Non-Prescribing Guardrail
            </div>
            <p className="text-zinc-400 leading-relaxed">
              The agent must NEVER say "You should take X at Y dose." It strictly maintains an educational and evidence-informing stance, referring dosage questions to the user's healthcare provider.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
