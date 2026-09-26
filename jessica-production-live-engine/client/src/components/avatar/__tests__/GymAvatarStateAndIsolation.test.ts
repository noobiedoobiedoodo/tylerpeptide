/**
 * client/src/components/avatar/__tests__/GymAvatarStateAndIsolation.test.ts
 * 
 * Forensic Test Suite for the Live 3D Bodybuilder Specialist Avatar.
 * Verifies:
 * 1. ZERO automotive / Jessica / CRM contamination in avatar code
 * 2. 4-state animation transitions (IDLE, LISTENING, SPEAKING, TRAINING)
 * 3. Curl interruption when user or agent speaks
 * 4. Real-time viseme calculation & rapid mouth closure on silence
 * 5. Robust fallback behavior
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BodybuilderCharacter } from '../BodybuilderCharacter';
import { DuckBodybuilderCharacter } from '../DuckBodybuilderCharacter';
import { GymEnvironment } from '../GymEnvironment';

describe('Live 3D Bodybuilder Avatar Forensic Suite', () => {

  // ── TEST 1: CRITICAL ISOLATION AUDIT ──────────────────────────────────
  describe('P0 Architectural Isolation (Zero Automotive / Jessica Leaks)', () => {
    const avatarFiles = [
      path.resolve(__dirname, '../types.ts'),
      path.resolve(__dirname, '../GymEnvironment.ts'),
      path.resolve(__dirname, '../BodybuilderCharacter.ts'),
      path.resolve(__dirname, '../DuckBodybuilderCharacter.ts'),
      path.resolve(__dirname, '../GymAvatarCanvas.tsx'),
      path.resolve(__dirname, '../InteractiveVoicePortrait.tsx')
    ];

    it('has zero occurrences of forbidden automotive keywords', () => {
      const forbiddenTokens = [
        'yournewauto',
        'jessica',
        'buyerstate',
        'buyerprofile',
        'dealership',
        'tradein',
        'vin',
        'automotive',
        'vehicle'
      ];

      for (const filePath of avatarFiles) {
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();

        for (const token of forbiddenTokens) {
          // Token must not exist as a word anywhere in the avatar codebase
          const regex = new RegExp(`\\b${token}\\b`, 'i');
          const matched = regex.test(content);
          expect(matched, `Forbidden token "${token}" found in ${path.basename(filePath)}`).toBe(false);
        }
      }
    });

    it('has zero references to automotive CRM endpoints or external automotive tools', () => {
      for (const filePath of avatarFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).not.toContain('/api/voice');
        expect(content).not.toContain('/api/dealership');
        expect(content).not.toContain('update_buyer_intelligence');
      }
    });
  });

  // ── TEST 2: SKELETON & RIG STRUCTURE ───────────────────────────────────
  describe('Bodybuilder Rig & Hierarchy Conformance', () => {
    it('constructs a valid Mixamo-compliant hierarchical armature', () => {
      const character = new BodybuilderCharacter();
      expect(character.group).toBeDefined();
      expect(character.group.name).toBe('BodybuilderCharacter');

      // Verify essential bones in the hierarchy
      const root = character.group.getObjectByName('mixamorigHips_Root');
      expect(root).toBeDefined();

      const hips = character.group.getObjectByName('mixamorigHips');
      expect(hips).toBeDefined();

      const chest = character.group.getObjectByName('mixamorigSpine2_Chest');
      expect(chest).toBeDefined();

      const head = character.group.getObjectByName('mixamorigHead');
      expect(head).toBeDefined();

      const leftArm = character.group.getObjectByName('mixamorigLeftArm');
      expect(leftArm).toBeDefined();

      const rightArm = character.group.getObjectByName('mixamorigRightArm');
      expect(rightArm).toBeDefined();

      const dumbbell = character.group.getObjectByName('RightHand50lbDumbbell');
      expect(dumbbell).toBeDefined();

      character.dispose();
    });

    it('initializes Golden Era gym environment with dumbbells, bench, and lighting', () => {
      const env = new GymEnvironment();
      expect(env.group).toBeDefined();
      expect(env.group.name).toBe('GoldenEraGymEnvironment');

      // Check for spotlights and environment components
      const hasSpotlight = env.group.children.some(c => c.type === 'SpotLight');
      expect(hasSpotlight).toBe(true);

      const hasDirectionalLight = env.group.children.some(c => c.type === 'DirectionalLight');
      expect(hasDirectionalLight).toBe(true);

      env.dispose();
    });
  });

  // ── TEST 3: ANIMATION STATE MACHINE & TRANSITIONS ─────────────────────
  describe('Avatar State Transitions & Interruption Mechanics', () => {
    it('defaults to IDLE state with natural breathing when no audio is present', () => {
      const character = new BodybuilderCharacter();
      expect(character.state).toBe('IDLE');

      // Tick update with 0 audio
      character.update(1.0, 0.016, 0, 0);
      expect(character.state).toBe('IDLE');

      character.dispose();
    });

    it('transitions to LISTENING when user audio level exceeds threshold', () => {
      const character = new BodybuilderCharacter();
      
      // User speaks: userAudioLevel = 0.45
      character.update(1.0, 0.016, 0.45, 0);
      expect(character.state).toBe('LISTENING');

      character.dispose();
    });

    it('transitions to SPEAKING when agent audio level exceeds threshold', () => {
      const character = new BodybuilderCharacter();
      
      // Agent speaks: agentAudioLevel = 0.50
      character.update(1.0, 0.016, 0, 0.50);
      expect(character.state).toBe('SPEAKING');

      character.dispose();
    });

    it('enters TRAINING state when dumbbell curl is triggered', () => {
      const character = new BodybuilderCharacter();
      
      character.triggerTraining(3);
      character.update(1.0, 0.016, 0, 0);
      expect(character.state).toBe('TRAINING');

      character.dispose();
    });

    it('CRITICAL: User speech immediately interrupts dumbbell curl and forces LISTENING', () => {
      const character = new BodybuilderCharacter();
      
      // 1. Start curl
      character.triggerTraining(3);
      character.update(1.0, 0.016, 0, 0);
      expect(character.state).toBe('TRAINING');

      // 2. User interrupts by speaking
      character.update(1.05, 0.016, 0.40, 0);
      expect(character.state).toBe('LISTENING');

      // 3. User stops speaking -> returns to IDLE (curl does not resume inappropriately)
      character.update(2.0, 0.016, 0, 0);
      expect(character.state).toBe('IDLE');

      character.dispose();
    });

    it('CRITICAL: Gemini speech immediately interrupts dumbbell curl and forces SPEAKING', () => {
      const character = new BodybuilderCharacter();
      
      // 1. Start curl
      character.triggerTraining(3);
      character.update(1.0, 0.016, 0, 0);
      expect(character.state).toBe('TRAINING');

      // 2. Gemini begins speaking
      character.update(1.05, 0.016, 0, 0.35);
      expect(character.state).toBe('SPEAKING');

      character.dispose();
    });
  });

  // ── TEST 4: VISEME & MOUTH MOVEMENT ACCURACY ──────────────────────────
  describe('Audio Viseme Modulation & Mouth Closure Dynamics', () => {
    it('modulates jaw and mouth when viseme weights are applied during speech', () => {
      const character = new BodybuilderCharacter();

      character.applyVisemes({
        jawOpen: 0.85,
        mouthPucker: 0.4,
        mouthSmile: 0.1,
        mouthOpen: 0.8,
        browInnerUp: 0.3,
        eyeBlink: 0
      });

      // Character must have jaw depressed
      const jaw = (character as any).jawMesh;
      expect(jaw.position.y).toBeLessThan(0.04); // Dropped jaw position

      const mouth = (character as any).mouthMesh;
      expect(mouth.scale.y).toBeGreaterThan(1.0); // Opened mouth scale

      character.dispose();
    });

    it('snaps mouth shut cleanly when silence is reached (zero visemes)', () => {
      const character = new BodybuilderCharacter();

      // First open
      character.applyVisemes({
        jawOpen: 1.0,
        mouthPucker: 0,
        mouthSmile: 0,
        mouthOpen: 1.0,
        browInnerUp: 0,
        eyeBlink: 0
      });

      // Then silence
      character.applyVisemes({
        jawOpen: 0,
        mouthPucker: 0,
        mouthSmile: 0,
        mouthOpen: 0,
        browInnerUp: 0,
        eyeBlink: 0
      });

      const jaw = (character as any).jawMesh;
      expect(jaw.position.y).toBe(0.04); // Default neutral jaw position

      const mouth = (character as any).mouthMesh;
      expect(mouth.scale.x).toBe(1.0);
      expect(mouth.scale.y).toBe(1.0);

      character.dispose();
    });
  });

  // ── TEST 5: DUCK BODYBUILDER SPECIALIST ARCHITECTURE ──────────────────
  describe('Duck Bodybuilder Specialist Verification', () => {
    it('initializes DuckBodybuilderCharacter with DuckBodybuilderSpecialist group', () => {
      const duck = new DuckBodybuilderCharacter();
      expect(duck.group).toBeDefined();
      expect(duck.group.name).toBe('DuckBodybuilderSpecialist');
      expect(duck.state).toBe('IDLE');
      duck.dispose();
    });

    it('manages Duck state transitions and curl interruption', () => {
      const duck = new DuckBodybuilderCharacter();
      expect(duck.state).toBe('IDLE');

      // Trigger training
      duck.triggerTraining(3);
      expect(duck.state).toBe('TRAINING');

      // Interrupted by speech
      duck.interruptCurl();
      expect(duck.state).toBe('IDLE');

      duck.dispose();
    });
  });

});
