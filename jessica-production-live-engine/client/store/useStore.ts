import { create } from 'zustand';
import { 
  Scene, FormData, INITIAL_FORM_DATA, VEHICLE_TYPES, ScoreResult, ApprovalStatus,
  GameCarUpgrades, GAME_VEHICLES
} from '../types';
import { PLAYLIST, playSoundtrack, pauseSoundtrack, setSoundtrackVolume } from '../lib/playlist';

interface AppState {
  // Global Navigation
  scene: Scene;
  
  // User Data
  formData: FormData;
  leadCaptured: boolean;
  
  // Selection State
  currentVehicleIndex: number;
  isZoomed: boolean;
  
  // Engine Output
  eligibilityScore: number | null;
  approvalStatus: ApprovalStatus;
  scoreResult: ScoreResult | null;
  dataState: 'PENDING' | 'READY' | 'FAILED';
  
  // Actions
  setScene: (scene: Scene) => void;
  updateFormData: (updates: Partial<FormData>) => void;
  setVehicle: (index: number) => void;
  setZoom: (isZoomed: boolean) => void;
  setApprovalResult: (status: ApprovalStatus, score: number) => void;
  setScoreResult: (result: ScoreResult) => void;
  setLeadCaptured: (status: boolean) => void;
  setDataState: (state: AppState['dataState']) => void;
  reset: () => void;

  // Easter Egg Spin Challenge state
  spinScore: number;
  spinChallengeActive: boolean;
  spinChallengeEnded: boolean;
  spinLeaderboard: { name: string; email: string; score: number }[];
  
  // Actions
  setSpinScore: (score: number) => void;
  startSpinChallenge: () => void;
  endSpinChallenge: () => void;
  resetSpinChallenge: () => void;
  fetchLeaderboard: () => Promise<void>;
  submitSpinScore: (name: string, email: string) => Promise<void>;

  // ==========================================
  // Your New Auto Underground GAME STATE
  // ==========================================
  gameProfile: {
    cash: number;
    ownedVehicles: string[];
    activeVehicleId: string;
  };
  gameUpgrades: Record<string, GameCarUpgrades>;
  activeRaceId: string | null;
  racesCleared: string[];
  raceResult: {
    cashEarned: number;
    isBusted: boolean;
    time: number;
    driftScore: number;
    nearMisses: number;
  } | null;

  buyGameCar: (id: string, price: number) => void;
  selectGameCar: (id: string) => void;
  upgradeGamePerformance: (id: string, part: 'engine' | 'tires' | 'nitro' | 'turbo', price: number) => void;
  upgradeGameVisual: (id: string, type: 'paintColor' | 'underglowColor' | 'spoilerType', value: string) => void;
  completeGameRace: (reward: number, isBusted: boolean, time: number, driftScore: number, nearMisses: number) => void;
  resetGameProfile: () => void;
  addGameCash: (amount: number) => void;

  // Music EA Trax states
  currentTrackIndex: number;
  isPlayingMusic: boolean;
  musicVolume: number;
  nextTrack: () => void;
  prevTrack: () => void;
  toggleMusicPlayback: () => void;
  setMusicVolume: (volume: number) => void;

  // Credit Classroom state
  classroomStation: number | null;
  classroomVisited: boolean[];
  setClassroomStation: (station: number | null) => void;
  markStationVisited: (station: number) => void;
}

const generateLeadId = () => `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

const DEFAULT_UPGRADE = (color: string): GameCarUpgrades => ({
  engine: 0,
  tires: 0,
  nitro: 0,
  turbo: 0,
  paintColor: color,
  underglowColor: 'none',
  spoilerType: 'none',
});

const INITIAL_GAME_UPGRADES: Record<string, GameCarUpgrades> = {
  car: DEFAULT_UPGRADE('#d63324'), // Racing Red
  suv: DEFAULT_UPGRADE('#00f3ff'), // Chrome Cyan
  truck: DEFAULT_UPGRADE('#ffcc00'), // Yellow
  van: DEFAULT_UPGRADE('#111111'), // Stealth Black
};

export const useStore = create<AppState>((set) => ({
  scene: 'HOW_IT_WORKS',
  formData: {
    ...INITIAL_FORM_DATA,
    id: generateLeadId(),
    vehicle: ''
  },
  leadCaptured: false,
  currentVehicleIndex: 1,
  isZoomed: false,
  eligibilityScore: null,
  approvalStatus: 'PENDING',
  scoreResult: null,
  dataState: 'PENDING',

  setScene: (scene) => set({ scene }),
  
  updateFormData: (updates) => set((state) => ({
    formData: { ...state.formData, ...updates }
  })),

  setVehicle: (index) => set((state) => ({
    currentVehicleIndex: index,
    formData: { ...state.formData, vehicle: VEHICLE_TYPES[index].label }
  })),

  setZoom: (isZoomed) => set({ isZoomed }),

  setApprovalResult: (approvalStatus, eligibilityScore) => set({
    approvalStatus,
    eligibilityScore
  }),

  setScoreResult: (scoreResult) => set({ 
    scoreResult,
    approvalStatus: scoreResult.status,
    eligibilityScore: scoreResult.approvalScore,
    dataState: 'READY'
  }),

  setLeadCaptured: (leadCaptured) => set({ leadCaptured }),
  
  setDataState: (dataState) => set({ dataState }),

  spinScore: 0,
  spinChallengeActive: false,
  spinChallengeEnded: false,
  spinLeaderboard: [],

  setSpinScore: (spinCount) => set((state) => {
    const points = spinCount === 0 ? 0 : Math.round(1000 * (Math.pow(3, spinCount) - 1) / 2);
    const updates: Partial<AppState> = { spinScore: points };
    if (spinCount >= 3 && !state.spinChallengeActive) {
      updates.spinChallengeActive = true;
      updates.spinChallengeEnded = false;
    }
    return updates;
  }),

  startSpinChallenge: () => set({ 
    spinChallengeActive: true, 
    spinChallengeEnded: false, 
    spinScore: 0 
  }),

  endSpinChallenge: () => set({ 
    spinChallengeEnded: true 
  }),

  resetSpinChallenge: () => set({ 
    spinScore: 0, 
    spinChallengeActive: false, 
    spinChallengeEnded: false 
  }),

  fetchLeaderboard: async () => {
    try {
      const res = await fetch('/api/scores');
      if (res.ok) {
        const data = await res.json();
        set({ spinLeaderboard: data });
      }
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
    }
  },

  submitSpinScore: async (name, email) => {
    const { spinScore } = useStore.getState();
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, score: spinScore }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ spinLeaderboard: data });
      }
    } catch (err) {
      console.error("Failed to submit score:", err);
    }
  },

  // ==========================================
  // Your New Auto Underground GAME STORE IMPLEMENTATION
  // ==========================================
  gameProfile: {
    cash: 15000,
    ownedVehicles: ['car'],
    activeVehicleId: 'car',
  },
  gameUpgrades: INITIAL_GAME_UPGRADES,
  activeRaceId: null,
  racesCleared: [],
  raceResult: null,

  currentTrackIndex: 0,
  isPlayingMusic: false,
  musicVolume: 0.35,

  nextTrack: () => set((state) => {
    const nextIdx = (state.currentTrackIndex + 1) % PLAYLIST.length;
    if (state.isPlayingMusic) {
      playSoundtrack(PLAYLIST[nextIdx].url, state.musicVolume);
    }
    return { currentTrackIndex: nextIdx };
  }),

  prevTrack: () => set((state) => {
    const prevIdx = (state.currentTrackIndex - 1 + PLAYLIST.length) % PLAYLIST.length;
    if (state.isPlayingMusic) {
      playSoundtrack(PLAYLIST[prevIdx].url, state.musicVolume);
    }
    return { currentTrackIndex: prevIdx };
  }),

  toggleMusicPlayback: () => set((state) => {
    const nextPlayState = !state.isPlayingMusic;
    if (nextPlayState) {
      playSoundtrack(PLAYLIST[state.currentTrackIndex].url, state.musicVolume);
    } else {
      pauseSoundtrack();
    }
    return { isPlayingMusic: nextPlayState };
  }),

  setMusicVolume: (volume) => set((state) => {
    setSoundtrackVolume(volume);
    return { musicVolume: volume };
  }),

  buyGameCar: (id, price) => set((state) => {
    if (state.gameProfile.cash < price) return {};
    const updatedProfile = {
      ...state.gameProfile,
      cash: state.gameProfile.cash - price,
      ownedVehicles: [...state.gameProfile.ownedVehicles, id],
      activeVehicleId: id,
    };
    return { gameProfile: updatedProfile };
  }),

  selectGameCar: (id) => set((state) => {
    if (!state.gameProfile.ownedVehicles.includes(id)) return {};
    return {
      gameProfile: {
        ...state.gameProfile,
        activeVehicleId: id,
      }
    };
  }),

  upgradeGamePerformance: (id, part, price) => set((state) => {
    if (state.gameProfile.cash < price) return {};
    const carUpgrades = state.gameUpgrades[id];
    if (!carUpgrades) return {};

    const nextLevel = Math.min(3, carUpgrades[part] + 1);
    const updatedUpgrades = {
      ...state.gameUpgrades,
      [id]: {
        ...carUpgrades,
        [part]: nextLevel,
      }
    };

    return {
      gameProfile: {
        ...state.gameProfile,
        cash: state.gameProfile.cash - price,
      },
      gameUpgrades: updatedUpgrades,
    };
  }),

  upgradeGameVisual: (id, type, value) => set((state) => {
    const carUpgrades = state.gameUpgrades[id];
    if (!carUpgrades) return {};

    const updatedUpgrades = {
      ...state.gameUpgrades,
      [id]: {
        ...carUpgrades,
        [type]: value,
      }
    };

    return { gameUpgrades: updatedUpgrades };
  }),

  completeGameRace: (reward, isBusted, time, driftScore, nearMisses) => set((state) => {
    const cashEarned = isBusted ? 0 : reward;
    const currentRaceId = state.activeRaceId;
    const updatedRacesCleared = currentRaceId && !isBusted && !state.racesCleared.includes(currentRaceId)
      ? [...state.racesCleared, currentRaceId]
      : state.racesCleared;

    return {
      gameProfile: {
        ...state.gameProfile,
        cash: state.gameProfile.cash + cashEarned,
      },
      racesCleared: updatedRacesCleared,
      raceResult: {
        cashEarned,
        isBusted,
        time,
        driftScore,
        nearMisses,
      },
      scene: 'GAME_RACE_RESULT',
    };
  }),

  addGameCash: (amount) => set((state) => ({
    gameProfile: {
      ...state.gameProfile,
      cash: state.gameProfile.cash + amount,
    }
  })),

  resetGameProfile: () => set({
    gameProfile: {
      cash: 15000,
      ownedVehicles: ['car'],
      activeVehicleId: 'car',
    },
    gameUpgrades: INITIAL_GAME_UPGRADES,
    activeRaceId: null,
    racesCleared: [],
    raceResult: null,
  }),

  // Credit Classroom implementation
  classroomStation: null,
  classroomVisited: [false, false, false, false, false, false, false, false],
  setClassroomStation: (station) => set({ classroomStation: station }),
  markStationVisited: (station) => set((state) => {
    const visited = [...state.classroomVisited];
    visited[station] = true;
    return { classroomVisited: visited };
  }),

  reset: () => set({
    scene: 'ENTRY',
    formData: {
      ...INITIAL_FORM_DATA,
      id: generateLeadId(),
      vehicle: ''
    },
    leadCaptured: false,
    currentVehicleIndex: 1,
    isZoomed: false,
    eligibilityScore: null,
    approvalStatus: 'PENDING',
    scoreResult: null,
    dataState: 'PENDING',
    spinScore: 0,
    spinChallengeActive: false,
    spinChallengeEnded: false,
    // Reset game state as well on global reset
    gameProfile: {
      cash: 15000,
      ownedVehicles: ['car'],
      activeVehicleId: 'car',
    },
    gameUpgrades: INITIAL_GAME_UPGRADES,
    activeRaceId: null,
    racesCleared: [],
    raceResult: null,
    // Reset classroom state
    classroomStation: null,
    classroomVisited: [false, false, false, false, false, false, false, false],
  })
}));

