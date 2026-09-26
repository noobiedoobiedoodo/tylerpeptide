import React from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Phone,
  Car,
  DollarSign,
  ShieldCheck,
  Zap,
  TrendingUp,
  Activity,
  CheckCircle2,
  Tag
} from 'lucide-react';
import { BuyerProfile, LeadIntelligenceMetrics } from '../services/voice/live/voiceLeadExtractor';

interface JarvisBlueprintCardsProps {
  profile?: BuyerProfile;
  metrics?: LeadIntelligenceMetrics | null;
}

export const JarvisBlueprintCards: React.FC<JarvisBlueprintCardsProps> = ({ profile, metrics }) => {
  const name = profile?.name;
  const phone = profile?.phone;
  const targetVehicle = profile?.targetVehicle || profile?.vehicleType;
  const budget = profile?.monthlyBudget ? `$${profile.monthlyBudget.toLocaleString()}/mo` : undefined;
  const credit = profile?.creditSituation;
  const downPayment = profile?.downPayment ? `$${profile.downPayment.toLocaleString()}` : undefined;
  const trade = profile?.hasTrade ? (profile?.tradeVehicle || 'Trade-In Active') : undefined;

  const intentScore = metrics?.intentScore ?? 0;
  const intentStage = metrics?.intentStage || 'DISCOVERY';
  const nextAction = metrics?.nextBestAction || 'ENGAGE';

  return (
    <div className="w-full max-w-4xl mx-auto px-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {/* Buyer Identity */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-black/60 backdrop-blur-md border border-cyan-500/30 rounded-xl p-2.5 shadow-lg flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-cyan-400 text-[10px] font-mono uppercase tracking-wider mb-1">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              Buyer
            </span>
            {phone && <ShieldCheck className="w-3 h-3 text-emerald-400" />}
          </div>
          <div className="font-semibold text-white truncate">
            {name || <span className="text-zinc-500 italic">Listening...</span>}
          </div>
          <div className="text-[11px] text-cyan-300/80 font-mono mt-0.5 truncate">
            {phone || <span className="text-zinc-600">No phone yet</span>}
          </div>
        </motion.div>

        {/* Target Vehicle */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-black/60 backdrop-blur-md border border-blue-500/30 rounded-xl p-2.5 shadow-lg flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-blue-400 text-[10px] font-mono uppercase tracking-wider mb-1">
            <span className="flex items-center gap-1">
              <Car className="w-3 h-3" />
              Vehicle
            </span>
            {trade && <Tag className="w-3 h-3 text-amber-400" />}
          </div>
          <div className="font-semibold text-white truncate">
            {targetVehicle || <span className="text-zinc-500 italic">Exploring...</span>}
          </div>
          <div className="text-[11px] text-blue-300/80 font-mono mt-0.5 truncate">
            {trade ? `Trade: ${trade}` : 'No trade stated'}
          </div>
        </motion.div>

        {/* Financial Context */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-black/60 backdrop-blur-md border border-emerald-500/30 rounded-xl p-2.5 shadow-lg flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-emerald-400 text-[10px] font-mono uppercase tracking-wider mb-1">
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              Budget
            </span>
            {credit && <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300">{credit}</span>}
          </div>
          <div className="font-semibold text-white truncate">
            {budget || <span className="text-zinc-500 italic">Open budget</span>}
          </div>
          <div className="text-[11px] text-emerald-300/80 font-mono mt-0.5 truncate">
            {downPayment ? `Down: ${downPayment}` : 'Zero down'}
          </div>
        </motion.div>

        {/* AI Sales Stage & Next Best Action */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-black/60 backdrop-blur-md border border-amber-500/30 rounded-xl p-2.5 shadow-lg flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-amber-400 text-[10px] font-mono uppercase tracking-wider mb-1">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Intent {intentScore > 0 ? `(${intentScore}%)` : ''}
            </span>
            <span className="text-[9px] font-mono uppercase px-1 rounded bg-amber-500/20 text-amber-300">
              {intentStage}
            </span>
          </div>
          <div className="font-semibold text-amber-200 truncate flex items-center gap-1 text-[11px]">
            <Activity className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="truncate">{nextAction.replace(/_/g, ' ')}</span>
          </div>
          <div className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate">
            {metrics?.recommendedNextAction ? metrics.recommendedNextAction : 'Jessica Concierge Active'}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
