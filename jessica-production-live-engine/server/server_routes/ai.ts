import { GoogleGenAI } from "@google/genai";

export let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

export function calculateLeadIntelligence(context: any = {}, signals: any = [], message = '') {
  const safeSignals = Array.isArray(signals)
    ? signals
    : signals
      ? [signals]
      : [];

  const signalTypes = new Set(
    safeSignals.map((s: any) => s?.type || s?.signalType).filter(Boolean)
  );
  const lowerMsg = (message || '').toLowerCase();

  // 1. INTENT SCORE (0-100) — Note: Contact info (Phone/Email) does NOT inflate Intent Score
  let intent = 0;
  if (signalTypes.has('PURCHASE_URGENCY') || String(context.urgency || '').toUpperCase() === 'IMMEDIATE' || String(context.urgency || '').toUpperCase() === 'HIGH' || /\b(asap|this week|right away|urgent|immediately|broken down)\b/i.test(lowerMsg)) {
    intent += 35;
  } else if (signalTypes.has('PURCHASE_TIMELINE_IDENTIFIED') || context.purchaseTimeline || /\b(two weeks|2 weeks|this month|within a month)\b/i.test(lowerMsg)) {
    intent += 25;
  }

  if (signalTypes.has('PAYMENT_TARGET_IDENTIFIED') || context.monthlyBudget || context.paymentTarget) intent += 20;
  if (signalTypes.has('VEHICLE_IDENTIFIED') || context.targetVehicle || context.vehicleType) intent += 15;
  if (signalTypes.has('TRADE_IDENTIFIED') || context.hasTrade || context.tradeVehicle) intent += 15;
  if (signalTypes.has('APPLICATION_INTENT') || signalTypes.has('APPROVAL_REQUESTED') || /\b(apply|approval|approved|pre-approval|prequalify)\b/i.test(lowerMsg)) intent += 20;
  if (signalTypes.has('HUMAN_HANDOFF_REQUESTED') || /\b(stephan|call me|talk to someone|advisor|agent)\b/i.test(lowerMsg)) intent += 20;
  if (signalTypes.has('AVAILABILITY_REQUESTED') || /\b(in stock|available|inventory)\b/i.test(lowerMsg)) intent += 10;
  if (signalTypes.has('FINANCING_REQUESTED') || context.financingNeeded) intent += 10;

  // Negative Intent Penalties
  if (signalTypes.has('EXPLICITLY_BROWSING') || /\b(just looking|just browsing|not buying|only curious)\b/i.test(lowerMsg)) intent -= 35;
  if (signalTypes.has('REFUSED_FOLLOWUP') || /\b(do not call|don't contact|no phone)\b/i.test(lowerMsg)) intent -= 40;
  if (signalTypes.has('NO_VEHICLE_NEED')) intent -= 30;

  intent = Math.max(0, Math.min(100, intent));

  let intentStage = 'CURIOUS';
  if (intent >= 81) intentStage = 'HIGH_INTENT';
  else if (intent >= 61) intentStage = 'QUALIFIED';
  else if (intent >= 41) intentStage = 'SHOPPING';
  else if (intent >= 21) intentStage = 'RESEARCHING';

  // 2. CONTACTABILITY SCORE (0-100) — Governs how reachable the lead is
  let contactability = 0;
  const rawPhone = String(context.phone || '').replace(/\D/g, '');
  if (rawPhone.length >= 10) contactability += 60;
  else if (rawPhone.length >= 7) contactability += 40;

  if (context.email && String(context.email).includes('@') && String(context.email).includes('.')) contactability += 30;
  if (context.name || context.firstName) contactability += 10;
  contactability = Math.max(0, Math.min(100, contactability));

  // 3. QUALIFICATION SCORE (0-100) — Governs bankability & lender matching
  let qualification = 0;
  if (context.monthlyIncome || context.income) qualification += 35;
  if (context.creditSituation || context.creditScore || context.creditProfile) qualification += 25;
  if (context.monthlyBudget || context.paymentTarget) qualification += 20;
  if (context.employment || context.employmentStatus) qualification += 10;
  if (context.downPayment || context.hasTrade || context.tradeVehicle) qualification += 10;
  qualification = Math.max(0, Math.min(100, qualification));

  // 4. LEAD COMPLETENESS (0-100%) — Proportion of key sales facts known
  const completenessItems = [
    Boolean(context.name || context.firstName),
    Boolean(rawPhone.length >= 7),
    Boolean(context.email && String(context.email).includes('@')),
    Boolean(context.targetVehicle || context.vehicleType),
    Boolean(context.monthlyBudget || context.paymentTarget),
    Boolean(context.purchaseTimeline || context.urgency),
    Boolean(context.creditSituation || context.creditScore),
    Boolean(context.hasTrade !== undefined || context.tradeVehicle),
    Boolean(context.monthlyIncome || context.income || context.downPayment)
  ];
  const filledCount = completenessItems.filter(Boolean).length;
  const completeness = Math.round((filledCount / completenessItems.length) * 100);

  // 5. TOP-LEVEL LEAD QUALITY SCORE (0-100)
  // Weighted: Intent 40%, Contactability 25%, Qualification 25%, Completeness 10%
  const leadQualityScore = Math.round(
    (intent * 0.40) +
    (contactability * 0.25) +
    (qualification * 0.25) +
    (completeness * 0.10)
  );

  // 6. BUYING COMMITMENT LAYER
  let buyingCommitment = 'NONE';
  if (
    signalTypes.has('APPLICATION_INTENT') ||
    signalTypes.has('HUMAN_HANDOFF_REQUESTED') ||
    /\b(apply|ready to buy|take my application|stephan call|call me)\b/i.test(lowerMsg)
  ) {
    buyingCommitment = 'READY_TO_PROCEED';
  } else if (
    (context.purchaseTimeline && context.purchaseTimeline !== 'EXPLORING') ||
    signalTypes.has('PURCHASE_URGENCY') ||
    (context.targetVehicle && context.monthlyBudget) ||
    /\b(this week|two weeks|this month|asap|comparing|need a)\b/i.test(lowerMsg)
  ) {
    buyingCommitment = 'ACTIVELY_SHOPPING';
  } else if (
    context.targetVehicle || context.monthlyBudget ||
    /\b(thinking|looking around|considering|maybe)\b/i.test(lowerMsg)
  ) {
    buyingCommitment = 'CONSIDERING';
  } else if (/\b(just browsing|someday|future|curious)\b/i.test(lowerMsg)) {
    buyingCommitment = 'EXPLORING';
  }

  // 7. OBJECTION DETECTION
  let activeObjection: string | null = null;
  if (/\b(too expensive|can't afford|high payment|cheaper|too much)\b/i.test(lowerMsg)) activeObjection = 'PAYMENT_CONCERN';
  else if (/\b(bad credit|turned down|bankruptcy|low score|collections|rebuilding)\b/i.test(lowerMsg)) activeObjection = 'CREDIT_CONCERN';
  else if (/\b(no down payment|zero down|no deposit|no cash down)\b/i.test(lowerMsg)) activeObjection = 'DOWN_PAYMENT_CONCERN';
  else if (/\b(not sure|need to think|too soon|not ready)\b/i.test(lowerMsg)) activeObjection = 'TIMING_CONCERN';
  else if (/\b(rate|apr|interest|hidden fees)\b/i.test(lowerMsg)) activeObjection = 'PRICE_CONCERN';

  // 8. NEXT BEST ACTION
  let nextBestAction = 'DISCOVER';
  if (activeObjection) {
    nextBestAction = 'OVERCOME_OBJECTION';
  } else if (
    signalTypes.has('HUMAN_HANDOFF_REQUESTED') ||
    buyingCommitment === 'READY_TO_PROCEED' ||
    (intent >= 70 && contactability >= 60)
  ) {
    nextBestAction = 'HANDOFF_NOW';
  } else if (intent >= 50 && contactability < 60) {
    nextBestAction = 'CAPTURE_PHONE';
  } else if (intent >= 50 && contactability >= 60 && !context.email) {
    nextBestAction = 'CAPTURE_EMAIL';
  } else if (!context.targetVehicle && !context.monthlyBudget) {
    nextBestAction = 'DISCOVER';
  } else if (context.targetVehicle && !context.creditSituation && !context.monthlyIncome) {
    nextBestAction = 'QUALIFY';
  } else if (intent < 30) {
    nextBestAction = 'EDUCATE';
  }

  // 9. RECOMMENDED NEXT ACTION FOR STEPHAN
  let recommendedNextAction = 'NURTURE';
  if (intent >= 75 && contactability >= 60) {
    recommendedNextAction = 'CALL_ASAP';
  } else if (intent >= 50 && contactability >= 60) {
    recommendedNextAction = 'SCHEDULE_CALL';
  } else if (contactability >= 30) {
    recommendedNextAction = 'EMAIL_PORTFOLIO';
  }

  return {
    intentScore: intent,
    intentStage,
    contactabilityScore: contactability,
    qualificationScore: qualification,
    completenessScore: completeness,
    leadQualityScore,
    buyingCommitment,
    nextBestAction,
    activeObjection,
    recommendedNextAction
  };
}
