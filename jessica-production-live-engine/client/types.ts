/**
 * client/types.ts
 * Core domain types and state schemas for the Jessica Live Platform.
 */

export type Scene = 'ENTRY' | 'VEHICLE_SELECTOR' | 'QUESTION_FLOW' | 'PROCESSING' | 'RESULT' | 'CATALOG' | 'ADMIN' | 'PRIVACY' | 'GAME_GARAGE' | 'GAME_RACING' | 'GAME_DEALERSHIP' | 'GAME_VISUAL_SHOP' | 'GAME_PERFORMANCE_SHOP' | 'GAME_RACE_MAP' | 'GAME_RACE_RESULT' | 'CREDIT_CLASSROOM';

export interface FormData {
  id?: string;
  vehicle: string;
  email: string;
  name: string;
  phone: string;
  category?: string;
  employment: string;
  income: string;
  creditScore: string;
  monthlyDebt: string;
  housingStatus: string;
  downPayment: string;
  selectedModel?: string;
  selectedModelYear?: number;
  marketingConsent?: boolean;
  privacyConsent?: boolean;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'CONDITIONAL' | 'REVIEW';

export interface ScoreResult {
  approvalScore: number;
  riskTier: "low" | "moderate" | "high" | "very_high";
  maxLoan: number;
  monthlyEstimate: number;
  tdsr?: number;
  pti?: number;
  reasonCodes: string[];
  status: ApprovalStatus;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  routing: string;
  offer: string;
}

export const INITIAL_FORM_DATA: FormData = {
  vehicle: '',
  email: '',
  name: '',
  phone: '',
  employment: '',
  income: '',
  creditScore: '',
  monthlyDebt: '0',
  housingStatus: 'rent',
  downPayment: '0',
  marketingConsent: false,
  privacyConsent: false,
};

export const VEHICLE_TYPES = [
  { id: 'car', label: 'Car', model: 'sedan' },
  { id: 'suv', label: 'SUV', model: 'suv' },
  { id: 'truck', label: 'Truck', model: 'truck' },
  { id: 'van', label: 'Van', model: 'van' }
];

export const CINEMATIC_EASE = [0.22, 1, 0.36, 1] as any;

export interface GameCarUpgrades {
  engine: number;
  tires: number;
  nitro: number;
  turbo: number;
  paintColor: string;
  underglowColor: string;
  spoilerType: 'none' | 'lip' | 'gt';
}

export interface GameVehicle {
  id: string;
  name: string;
  price: number;
  baseStats: {
    speed: number;
    acceleration: number;
    handling: number;
    nitro: number;
  };
}

export interface RaceLevel {
  id: string;
  name: string;
  crewBoss: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Extreme';
  distance: number;
  reward: number;
  reqRating: number;
  description: string;
}

export const GAME_VEHICLES: GameVehicle[] = [
  { id: 'car', name: 'Eclipse-SX Tuner', price: 10000, baseStats: { speed: 45, acceleration: 50, handling: 65, nitro: 40 } },
  { id: 'suv', name: 'Outlaw Cruiser', price: 22000, baseStats: { speed: 55, acceleration: 40, handling: 45, nitro: 50 } },
  { id: 'truck', name: 'Raptor V8 Utility', price: 35000, baseStats: { speed: 60, acceleration: 55, handling: 50, nitro: 45 } },
  { id: 'van', name: 'Blackout Express', price: 48000, baseStats: { speed: 70, acceleration: 65, handling: 55, nitro: 60 } }
];

export const GAME_RACES: RaceLevel[] = [
  { id: 'race_01', name: 'Neon Grid Sprint', crewBoss: 'Slick Rick', difficulty: 'Easy', distance: 1000, reward: 2500, reqRating: 40, description: 'Learn the ropes. Dodge basic street traffic and hit the nitro.' },
  { id: 'race_02', name: 'Industrial Escape', crewBoss: 'Big Diesel', difficulty: 'Medium', distance: 1500, reward: 5000, reqRating: 100, description: 'Cops have established a local patrol. Break through their blockade!' },
  { id: 'race_03', name: 'Midnight Parkway', crewBoss: 'Drift Queen Reina', difficulty: 'Medium', distance: 2000, reward: 8000, reqRating: 180, description: 'A long stretch highway sprint. High speed and dense traffic.' },
  { id: 'race_04', name: 'Downtown Hustle', crewBoss: 'The Ghost Van', difficulty: 'Hard', distance: 2500, reward: 12000, reqRating: 260, description: 'Bumper-to-bumper city congestion. Police presence is extremely aggressive.' },
  { id: 'race_05', name: 'Underground Finale', crewBoss: 'V12 Apex Legend', difficulty: 'Extreme', distance: 3000, reward: 25000, reqRating: 340, description: 'The final showdown against the city\'s fastest. Outrun the ultimate interceptor.' }
];
