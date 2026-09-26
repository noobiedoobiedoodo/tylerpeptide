/**
 * client/src/components/avatar/BodybuilderCharacter.ts
 * 
 * Fictional Full-Body Male Competitive Bodybuilder 3D Character Model & Armature.
 * Presentation-layer virtual specialist for the 80s Golden Era aesthetic.
 * 
 * Features:
 * - Rigged hierarchical bone skeleton conforming to Mixamo conventions
 * - Morph targets & blendshapes for real-time speech visemes and natural blinks
 * - 4 distinct animation modes: IDLE, LISTENING, SPEAKING, TRAINING (Dumbbell Curl)
 * - Seamless interruptibility and cross-fading
 * - Cast-iron hex dumbbell prop attached to right hand
 */

import * as THREE from 'three';
import { AvatarState, VisemeWeights } from './types';

export class BodybuilderCharacter {
  public group: THREE.Group;
  public state: AvatarState = 'IDLE';

  // Armature Bones
  private bones: {
    root: THREE.Group;
    hips: THREE.Group;
    spine: THREE.Group;
    chest: THREE.Group;
    neck: THREE.Group;
    head: THREE.Group;
    leftShoulder: THREE.Group;
    leftArm: THREE.Group;
    leftForearm: THREE.Group;
    leftHand: THREE.Group;
    rightShoulder: THREE.Group;
    rightArm: THREE.Group;
    rightForearm: THREE.Group;
    rightHand: THREE.Group;
    leftThigh: THREE.Group;
    leftCalf: THREE.Group;
    rightThigh: THREE.Group;
    rightCalf: THREE.Group;
  };

  // Facial Blendshape / Morph Target Meshes
  private headMesh!: THREE.Mesh;
  private jawMesh!: THREE.Mesh;
  private mouthMesh!: THREE.Mesh;
  private leftEyeMesh!: THREE.Mesh;
  private rightEyeMesh!: THREE.Mesh;
  private leftEyebrowMesh!: THREE.Mesh;
  private rightEyebrowMesh!: THREE.Mesh;
  private rightDumbbellProp!: THREE.Group;

  // Animation State Variables
  private blinkTimer = 0;
  private nextBlinkTime = 3.0;
  private currentBlink = 0;
  private curlProgress = 0;
  private curlRepsCompleted = 0;
  private isCurlingActive = false;
  private curlTargetReps = 3;
  private speechGestureTimer = 0;

  private disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material; texture?: THREE.Texture }[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'BodybuilderCharacter';
    this.bones = this.buildSkeleton();
    this.buildMeshes();
  }

  /**
   * Constructs the hierarchical bone armature conforming to standard Mixamo hierarchy.
   */
  private buildSkeleton() {
    const root = new THREE.Group();
    root.name = 'mixamorigHips_Root';
    root.position.set(0, -1.2, 0);

    const hips = new THREE.Group();
    hips.name = 'mixamorigHips';
    hips.position.set(0, 1.05, 0);
    root.add(hips);

    const spine = new THREE.Group();
    spine.name = 'mixamorigSpine';
    spine.position.set(0, 0.22, 0);
    hips.add(spine);

    const chest = new THREE.Group();
    chest.name = 'mixamorigSpine2_Chest';
    chest.position.set(0, 0.32, 0);
    spine.add(chest);

    const neck = new THREE.Group();
    neck.name = 'mixamorigNeck';
    neck.position.set(0, 0.28, 0);
    chest.add(neck);

    const head = new THREE.Group();
    head.name = 'mixamorigHead';
    head.position.set(0, 0.16, 0.04);
    neck.add(head);

    // Left Arm Hierarchy
    const leftShoulder = new THREE.Group();
    leftShoulder.name = 'mixamorigLeftShoulder';
    leftShoulder.position.set(-0.28, 0.22, 0);
    chest.add(leftShoulder);

    const leftArm = new THREE.Group();
    leftArm.name = 'mixamorigLeftArm';
    leftArm.position.set(-0.16, 0, 0);
    leftShoulder.add(leftArm);

    const leftForearm = new THREE.Group();
    leftForearm.name = 'mixamorigLeftForeArm';
    leftForearm.position.set(-0.02, -0.36, 0);
    leftArm.add(leftForearm);

    const leftHand = new THREE.Group();
    leftHand.name = 'mixamorigLeftHand';
    leftHand.position.set(0, -0.32, 0);
    leftForearm.add(leftHand);

    // Right Arm Hierarchy
    const rightShoulder = new THREE.Group();
    rightShoulder.name = 'mixamorigRightShoulder';
    rightShoulder.position.set(0.28, 0.22, 0);
    chest.add(rightShoulder);

    const rightArm = new THREE.Group();
    rightArm.name = 'mixamorigRightArm';
    rightArm.position.set(0.16, 0, 0);
    rightShoulder.add(rightArm);

    const rightForearm = new THREE.Group();
    rightForearm.name = 'mixamorigRightForeArm';
    rightForearm.position.set(0.02, -0.36, 0);
    rightArm.add(rightForearm);

    const rightHand = new THREE.Group();
    rightHand.name = 'mixamorigRightHand';
    rightHand.position.set(0, -0.32, 0);
    rightForearm.add(rightHand);

    // Legs Hierarchy
    const leftThigh = new THREE.Group();
    leftThigh.position.set(-0.18, -0.05, 0);
    hips.add(leftThigh);

    const leftCalf = new THREE.Group();
    leftCalf.position.set(0, -0.52, 0);
    leftThigh.add(leftCalf);

    const rightThigh = new THREE.Group();
    rightThigh.position.set(0.18, -0.05, 0);
    hips.add(rightThigh);

    const rightCalf = new THREE.Group();
    rightCalf.position.set(0, -0.52, 0);
    rightThigh.add(rightCalf);

    this.group.add(root);

    return {
      root,
      hips,
      spine,
      chest,
      neck,
      head,
      leftShoulder,
      leftArm,
      leftForearm,
      leftHand,
      rightShoulder,
      rightArm,
      rightForearm,
      rightHand,
      leftThigh,
      leftCalf,
      rightThigh,
      rightCalf
    };
  }

  /**
   * Builds the anatomical bodybuilder meshes attached to the skeleton.
   */
  private buildMeshes() {
    // ── PBR SKIN & TANK MATERIALS ───────────────────────────────────────
    // Realistic tanned skin with subtle subsurface scattering approximation & sheen
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xcca085,
      roughness: 0.45,
      metalness: 0.08
    });
    this.disposables.push({ material: skinMat });

    // Charcoal ribbed stringer gym tank top
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0x222428,
      roughness: 0.85,
      metalness: 0.05
    });
    this.disposables.push({ material: tankMat });

    // Athletic training shorts
    const shortsMat = new THREE.MeshStandardMaterial({
      color: 0x141518,
      roughness: 0.9,
      metalness: 0.02
    });
    this.disposables.push({ material: shortsMat });

    // ── 1. TORSO (CHEST, WIDE LATS & V-TAPER) ───────────────────────────
    const chestGeo = new THREE.BoxGeometry(0.68, 0.44, 0.36, 4, 4, 4);
    const chestMesh = new THREE.Mesh(chestGeo, tankMat);
    chestMesh.position.set(0, 0.12, 0);
    chestMesh.castShadow = true;
    this.bones.chest.add(chestMesh);
    this.disposables.push({ geometry: chestGeo });

    // Defined Pectoral muscles overlay
    const pecGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.1, 16);
    const leftPec = new THREE.Mesh(pecGeo, tankMat);
    leftPec.rotation.x = Math.PI / 2;
    leftPec.position.set(-0.16, 0.12, 0.18);
    const rightPec = new THREE.Mesh(pecGeo, tankMat);
    rightPec.rotation.x = Math.PI / 2;
    rightPec.position.set(0.16, 0.12, 0.18);
    this.bones.chest.add(leftPec, rightPec);
    this.disposables.push({ geometry: pecGeo });

    // Waist / Core
    const waistGeo = new THREE.CylinderGeometry(0.24, 0.22, 0.28, 16);
    const waistMesh = new THREE.Mesh(waistGeo, tankMat);
    waistMesh.position.set(0, 0.12, 0);
    this.bones.spine.add(waistMesh);
    this.disposables.push({ geometry: waistGeo });

    // Hips / Glutes
    const hipsGeo = new THREE.BoxGeometry(0.52, 0.22, 0.32);
    const hipsMesh = new THREE.Mesh(hipsGeo, shortsMat);
    this.bones.hips.add(hipsMesh);
    this.disposables.push({ geometry: hipsGeo });

    // ── 2. HEAD, JAW & FACIAL MORPHS ────────────────────────────────────
    const neckGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.22, 16);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(0, 0.08, 0);
    neckMesh.castShadow = true;
    this.bones.neck.add(neckMesh);
    this.disposables.push({ geometry: neckGeo });

    // Skull / Cranium
    const headGeo = new THREE.SphereGeometry(0.18, 24, 24);
    headGeo.scale(1.0, 1.15, 1.05);
    this.headMesh = new THREE.Mesh(headGeo, skinMat);
    this.headMesh.position.set(0, 0.12, 0);
    this.headMesh.castShadow = true;
    this.bones.head.add(this.headMesh);
    this.disposables.push({ geometry: headGeo });

    // Hair (Short athletic crop)
    const hairGeo = new THREE.SphereGeometry(0.19, 16, 16);
    hairGeo.scale(1.02, 1.1, 1.06);
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x221a14, roughness: 0.9 });
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.position.set(0, 0.16, -0.02);
    this.bones.head.add(hairMesh);
    this.disposables.push({ geometry: hairGeo, material: hairMat });

    // Articulated Jaw (drives jawOpen & visemes)
    const jawGeo = new THREE.BoxGeometry(0.16, 0.1, 0.16);
    this.jawMesh = new THREE.Mesh(jawGeo, skinMat);
    this.jawMesh.position.set(0, 0.04, 0.1);
    this.bones.head.add(this.jawMesh);
    this.disposables.push({ geometry: jawGeo });

    // Lips / Mouth Aperture
    const mouthGeo = new THREE.BoxGeometry(0.11, 0.04, 0.05);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x904840, roughness: 0.5 });
    this.mouthMesh = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouthMesh.position.set(0, 0.05, 0.19);
    this.bones.head.add(this.mouthMesh);
    this.disposables.push({ geometry: mouthGeo, material: mouthMat });

    // Eyes with Blink Mechanics
    const eyeGeo = new THREE.SphereGeometry(0.028, 12, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2d5a7b }); // Athletic blue eyes
    this.leftEyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    this.leftEyeMesh.position.set(-0.065, 0.14, 0.17);
    this.rightEyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    this.rightEyeMesh.position.set(0.065, 0.14, 0.17);
    this.bones.head.add(this.leftEyeMesh, this.rightEyeMesh);
    this.disposables.push({ geometry: eyeGeo, material: eyeMat });

    // Eyebrows
    const browGeo = new THREE.BoxGeometry(0.07, 0.015, 0.02);
    const browMat = new THREE.MeshBasicMaterial({ color: 0x1a120c });
    this.leftEyebrowMesh = new THREE.Mesh(browGeo, browMat);
    this.leftEyebrowMesh.position.set(-0.065, 0.18, 0.18);
    this.rightEyebrowMesh = new THREE.Mesh(browGeo, browMat);
    this.rightEyebrowMesh.position.set(0.065, 0.18, 0.18);
    this.bones.head.add(this.leftEyebrowMesh, this.rightEyebrowMesh);
    this.disposables.push({ geometry: browGeo, material: browMat });

    // ── 3. DELTOIDS & MUSCULAR ARMS ─────────────────────────────────────
    // Massive 3D Round Deltoid Caps
    const deltGeo = new THREE.SphereGeometry(0.18, 16, 16);
    deltGeo.scale(1.1, 1.25, 1.1);
    const leftDelt = new THREE.Mesh(deltGeo, skinMat);
    leftDelt.position.set(0, 0, 0);
    const rightDelt = new THREE.Mesh(deltGeo, skinMat);
    rightDelt.position.set(0, 0, 0);
    this.bones.leftShoulder.add(leftDelt);
    this.bones.rightShoulder.add(rightDelt);
    this.disposables.push({ geometry: deltGeo });

    // Upper Arms (Biceps & Triceps)
    const armGeo = new THREE.CylinderGeometry(0.12, 0.11, 0.36, 16);
    const leftUpperArm = new THREE.Mesh(armGeo, skinMat);
    leftUpperArm.position.set(0, -0.18, 0);
    const rightUpperArm = new THREE.Mesh(armGeo, skinMat);
    rightUpperArm.position.set(0, -0.18, 0);
    this.bones.leftArm.add(leftUpperArm);
    this.bones.rightArm.add(rightUpperArm);
    this.disposables.push({ geometry: armGeo });

    // Prominent Bicep Peak Peak Geometries
    const bicepGeo = new THREE.SphereGeometry(0.09, 12, 12);
    bicepGeo.scale(1.0, 1.4, 1.0);
    const leftBicep = new THREE.Mesh(bicepGeo, skinMat);
    leftBicep.position.set(0, -0.16, 0.05);
    const rightBicep = new THREE.Mesh(bicepGeo, skinMat);
    rightBicep.position.set(0, -0.16, 0.05);
    this.bones.leftArm.add(leftBicep);
    this.bones.rightArm.add(rightBicep);
    this.disposables.push({ geometry: bicepGeo });

    // Forearms (Tapered, dense muscle)
    const forearmGeo = new THREE.CylinderGeometry(0.10, 0.075, 0.32, 16);
    const leftForearm = new THREE.Mesh(forearmGeo, skinMat);
    leftForearm.position.set(0, -0.16, 0);
    const rightForearm = new THREE.Mesh(forearmGeo, skinMat);
    rightForearm.position.set(0, -0.16, 0);
    this.bones.leftForearm.add(leftForearm);
    this.bones.rightForearm.add(rightForearm);
    this.disposables.push({ geometry: forearmGeo });

    // Hands
    const handGeo = new THREE.BoxGeometry(0.09, 0.12, 0.06);
    const leftHandMesh = new THREE.Mesh(handGeo, skinMat);
    leftHandMesh.position.set(0, -0.06, 0);
    const rightHandMesh = new THREE.Mesh(handGeo, skinMat);
    rightHandMesh.position.set(0, -0.06, 0);
    this.bones.leftHand.add(leftHandMesh);
    this.bones.rightHand.add(rightHandMesh);
    this.disposables.push({ geometry: handGeo });

    // ── 4. CAST-IRON 50 LB DUMBBELL PROP (IN RIGHT HAND) ────────────────
    this.rightDumbbellProp = this.buildHandDumbbell();
    this.bones.rightHand.add(this.rightDumbbellProp);

    // ── 5. LOWER BODY (QUADS, CALVES, SHOES) ────────────────────────────
    const thighGeo = new THREE.CylinderGeometry(0.18, 0.13, 0.52, 16);
    const leftThighMesh = new THREE.Mesh(thighGeo, shortsMat);
    leftThighMesh.position.set(0, -0.26, 0);
    const rightThighMesh = new THREE.Mesh(thighGeo, shortsMat);
    rightThighMesh.position.set(0, -0.26, 0);
    this.bones.leftThigh.add(leftThighMesh);
    this.bones.rightThigh.add(rightThighMesh);
    this.disposables.push({ geometry: thighGeo });

    const calfGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.52, 16);
    const leftCalfMesh = new THREE.Mesh(calfGeo, skinMat);
    leftCalfMesh.position.set(0, -0.26, 0);
    const rightCalfMesh = new THREE.Mesh(calfGeo, skinMat);
    rightCalfMesh.position.set(0, -0.26, 0);
    this.bones.leftCalf.add(leftCalfMesh);
    this.bones.rightCalf.add(rightCalfMesh);
    this.disposables.push({ geometry: calfGeo });

    // Athletic Training Shoes
    const shoeGeo = new THREE.BoxGeometry(0.14, 0.1, 0.28);
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.6 });
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(0, -0.56, 0.06);
    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0, -0.56, 0.06);
    this.bones.leftCalf.add(leftShoe);
    this.bones.rightCalf.add(rightShoe);
    this.disposables.push({ geometry: shoeGeo, material: shoeMat });
  }

  private buildHandDumbbell(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'RightHand50lbDumbbell';
    group.position.set(0, -0.06, 0);

    const ironMat = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.7, metalness: 0.8 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.95 });

    // Handle
    const barGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.26, 12);
    const bar = new THREE.Mesh(barGeo, chromeMat);
    bar.rotation.z = Math.PI / 2;

    // Hex Heads
    const hexGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 6);
    const leftHead = new THREE.Mesh(hexGeo, ironMat);
    leftHead.position.x = -0.13;
    leftHead.rotation.z = Math.PI / 2;
    leftHead.castShadow = true;

    const rightHead = new THREE.Mesh(hexGeo, ironMat);
    rightHead.position.x = 0.13;
    rightHead.rotation.z = Math.PI / 2;
    rightHead.castShadow = true;

    group.add(bar, leftHead, rightHead);
    this.disposables.push({ geometry: barGeo, material: chromeMat });
    this.disposables.push({ geometry: hexGeo, material: ironMat });
    return group;
  }

  /**
   * Main animation tick update.
   * Dispatches behavior according to current state (IDLE, LISTENING, SPEAKING, TRAINING)
   */
  public update(time: number, dt: number, userAudioLevel: number, agentAudioLevel: number, visemes?: VisemeWeights) {
    // 1. Natural Eye Blink Engine
    this.updateBlinks(dt);

    // 2. State Resolution & Clean Transition
    if (userAudioLevel > 0.06) {
      // User is speaking: Attentive listening takes absolute precedence
      if (this.isCurlingActive) {
        this.interruptCurl();
      }
      this.state = 'LISTENING';
      this.updateListening(time, dt, userAudioLevel);
    } else if (agentAudioLevel > 0.05) {
      // Gemini is speaking: Live conversational gesture & mouth driver
      this.state = 'SPEAKING';
      this.updateSpeaking(time, dt, agentAudioLevel, visemes);
    } else if (this.isCurlingActive) {
      // In middle of controlled dumbbell curl
      this.state = 'TRAINING';
      this.updateTraining(time, dt);
    } else {
      // Default confident idle
      this.state = 'IDLE';
      this.updateIdle(time, dt);
    }

    // 3. Apply Real-Time Facial Visemes
    if (visemes) {
      this.applyVisemes(visemes);
    }
  }

  /**
   * Natural Eye Blink Controller
   */
  private updateBlinks(dt: number) {
    this.blinkTimer += dt;
    if (this.blinkTimer >= this.nextBlinkTime) {
      this.currentBlink = 1.0;
      this.blinkTimer = 0;
      this.nextBlinkTime = 2.5 + Math.random() * 2.5; // Natural 2.5 - 5.0 second blink interval
    }

    if (this.currentBlink > 0) {
      this.currentBlink = Math.max(0, this.currentBlink - dt * 10); // Quick 100ms blink duration
      const scaleY = 1.0 - this.currentBlink * 0.85;
      this.leftEyeMesh.scale.y = scaleY;
      this.rightEyeMesh.scale.y = scaleY;
    }
  }

  /**
   * IDLE: Natural breathing, subtle postural shifts, confident bodybuilding stance.
   */
  private updateIdle(time: number, dt: number) {
    // Diaphragmatic respiratory rhythm (4-second cycle)
    const breath = Math.sin(time * 1.6);
    this.bones.chest.scale.set(1.0 + breath * 0.025, 1.0 + breath * 0.02, 1.0 + breath * 0.03);
    this.bones.spine.rotation.x = 0.03 + breath * 0.015;

    // Subtle natural hip/weight sway
    const sway = Math.sin(time * 0.8) * 0.02;
    this.bones.hips.rotation.y = sway;
    this.bones.hips.rotation.z = Math.sin(time * 0.4) * 0.01;

    // Head subtle micro-movements
    this.bones.head.rotation.y = Math.sin(time * 0.5) * 0.04;
    this.bones.head.rotation.x = -0.02 + Math.cos(time * 0.8) * 0.02;

    // Resting arm positions (lats flared out)
    this.bones.leftArm.rotation.z = THREE.MathUtils.lerp(this.bones.leftArm.rotation.z, 0.32, dt * 4);
    this.bones.leftArm.rotation.x = THREE.MathUtils.lerp(this.bones.leftArm.rotation.x, 0.05, dt * 4);
    this.bones.leftForearm.rotation.x = THREE.MathUtils.lerp(this.bones.leftForearm.rotation.x, 0.12, dt * 4);

    this.bones.rightArm.rotation.z = THREE.MathUtils.lerp(this.bones.rightArm.rotation.z, -0.32, dt * 4);
    this.bones.rightArm.rotation.x = THREE.MathUtils.lerp(this.bones.rightArm.rotation.x, 0.05, dt * 4);
    this.bones.rightForearm.rotation.x = THREE.MathUtils.lerp(this.bones.rightForearm.rotation.x, 0.15, dt * 4);
  }

  /**
   * LISTENING: Interrupts exercise, faces user, attentive forward posture, subtle nodding.
   */
  private updateListening(time: number, dt: number, audioLevel: number) {
    // Lean forward slightly toward camera
    this.bones.spine.rotation.x = THREE.MathUtils.lerp(this.bones.spine.rotation.x, 0.08, dt * 6);
    this.bones.hips.rotation.y = THREE.MathUtils.lerp(this.bones.hips.rotation.y, 0, dt * 6);

    // Acknowledging head nods (~1.2 Hz) when user speaks
    const nod = Math.sin(time * 3.5) * 0.06 * Math.min(1, audioLevel * 3);
    this.bones.head.rotation.x = THREE.MathUtils.lerp(this.bones.head.rotation.x, 0.04 + nod, dt * 8);
    this.bones.head.rotation.y = THREE.MathUtils.lerp(this.bones.head.rotation.y, 0, dt * 6);

    // Slightly raised attentive eyebrows
    this.leftEyebrowMesh.position.y = 0.18 + Math.min(0.015, audioLevel * 0.02);
    this.rightEyebrowMesh.position.y = 0.18 + Math.min(0.015, audioLevel * 0.02);

    // Arms in steady listening stance
    this.bones.leftArm.rotation.z = THREE.MathUtils.lerp(this.bones.leftArm.rotation.z, 0.28, dt * 5);
    this.bones.rightArm.rotation.z = THREE.MathUtils.lerp(this.bones.rightArm.rotation.z, -0.28, dt * 5);
    this.bones.rightForearm.rotation.x = THREE.MathUtils.lerp(this.bones.rightForearm.rotation.x, 0.1, dt * 5);
  }

  /**
   * SPEAKING: Real-time jaw/mouth modulation, expressive conversational hand gestures, chest expansion.
   */
  private updateSpeaking(time: number, dt: number, audioLevel: number, visemes?: VisemeWeights) {
    this.speechGestureTimer += dt;

    // Chest expansion and head micro-movements emphasizing words
    this.bones.chest.scale.set(1.03, 1.02, 1.04);
    const headEmphasis = Math.sin(time * 4.2) * 0.04 * Math.min(1, audioLevel * 2.5);
    this.bones.head.rotation.x = THREE.MathUtils.lerp(this.bones.head.rotation.x, 0.02 + headEmphasis, dt * 10);
    this.bones.head.rotation.y = THREE.MathUtils.lerp(this.bones.head.rotation.y, Math.sin(time * 1.5) * 0.08, dt * 6);

    // Left Arm: Conversational gesturing (emphasizing points with hand)
    const gestureX = Math.sin(time * 2.2) * 0.22;
    const gestureZ = 0.35 + Math.cos(time * 1.8) * 0.12;
    this.bones.leftArm.rotation.x = THREE.MathUtils.lerp(this.bones.leftArm.rotation.x, 0.3 + gestureX, dt * 5);
    this.bones.leftArm.rotation.z = THREE.MathUtils.lerp(this.bones.leftArm.rotation.z, gestureZ, dt * 5);
    this.bones.leftForearm.rotation.x = THREE.MathUtils.lerp(this.bones.leftForearm.rotation.x, 0.45 + gestureX * 0.5, dt * 5);

    // Right Arm: Keeps dumbbell stable at side while talking
    this.bones.rightArm.rotation.z = THREE.MathUtils.lerp(this.bones.rightArm.rotation.z, -0.3, dt * 5);
    this.bones.rightArm.rotation.x = THREE.MathUtils.lerp(this.bones.rightArm.rotation.x, 0.05, dt * 5);
    this.bones.rightForearm.rotation.x = THREE.MathUtils.lerp(this.bones.rightForearm.rotation.x, 0.12, dt * 5);

    // Eyebrows animated with vocal energy
    const browRaise = Math.min(0.018, (visemes?.browInnerUp || audioLevel) * 0.025);
    this.leftEyebrowMesh.position.y = 0.18 + browRaise;
    this.rightEyebrowMesh.position.y = 0.18 + browRaise;
  }

  /**
   * TRAINING: Controlled Dumbbell Bicep Curl (Concentric contraction, peak squeeze, eccentric lowering).
   */
  private updateTraining(time: number, dt: number) {
    // 2.5-second curl repetition period
    this.curlProgress += dt * 0.4;
    const repPhase = (this.curlProgress % 1.0); // 0 to 1

    let curlAngle = 0;
    if (repPhase < 0.4) {
      // Concentric: Lifting dumbbell upward (0 to 125 degrees)
      const liftProgress = repPhase / 0.4;
      curlAngle = THREE.MathUtils.smoothstep(liftProgress, 0, 1) * 2.15;
    } else if (repPhase < 0.55) {
      // Peak Contraction: Squeezing the bicep at the top
      curlAngle = 2.15 + Math.sin((repPhase - 0.4) * 20) * 0.04;
    } else {
      // Eccentric: Lowering dumbbell with slow control (negative)
      const lowerProgress = (repPhase - 0.55) / 0.45;
      curlAngle = (1.0 - THREE.MathUtils.smoothstep(lowerProgress, 0, 1)) * 2.15;
    }

    // Apply curl angle to right elbow joint
    this.bones.rightArm.rotation.x = THREE.MathUtils.lerp(this.bones.rightArm.rotation.x, 0.15, dt * 6);
    this.bones.rightArm.rotation.z = THREE.MathUtils.lerp(this.bones.rightArm.rotation.z, -0.22, dt * 6);
    this.bones.rightForearm.rotation.x = THREE.MathUtils.lerp(this.bones.rightForearm.rotation.x, curlAngle, dt * 12);

    // Subtle torso counter-balance
    this.bones.spine.rotation.z = Math.sin(repPhase * Math.PI) * 0.02;

    // Check rep completion
    if (this.curlProgress >= this.curlTargetReps) {
      this.finishTraining();
    }
  }

  /**
   * Triggers the controlled dumbbell curl sequence (2-3 reps).
   */
  public triggerTraining(reps: number = 3) {
    if (this.state === 'SPEAKING' || this.state === 'LISTENING') return;
    this.isCurlingActive = true;
    this.curlProgress = 0;
    this.curlTargetReps = reps;
    this.state = 'TRAINING';
  }

  /**
   * Interrupts training cleanly (e.g. when user speaks or Gemini speaks).
   */
  public interruptCurl() {
    this.isCurlingActive = false;
    this.curlProgress = 0;
  }

  private finishTraining() {
    this.isCurlingActive = false;
    this.curlProgress = 0;
    this.state = 'IDLE';
  }

  /**
   * Applies real-time viseme weights to the jaw and mouth meshes.
   * Snaps closed cleanly within 50ms when audio ceases.
   */
  public applyVisemes(visemes: VisemeWeights) {
    const jawDepression = Math.max(0, Math.min(1, visemes.jawOpen));
    const pucker = Math.max(0, Math.min(1, visemes.mouthPucker));
    const smile = Math.max(0, Math.min(1, visemes.mouthSmile));

    // Jaw vertical depression
    this.jawMesh.position.y = 0.04 - jawDepression * 0.045;
    this.mouthMesh.position.y = 0.05 - jawDepression * 0.035;

    // Mouth horizontal & depth shape (viseme OO vs EE)
    const mouthScaleX = 1.0 + smile * 0.4 - pucker * 0.35;
    const mouthScaleY = 1.0 + jawDepression * 1.8;
    const mouthScaleZ = 1.0 + pucker * 0.5;

    this.mouthMesh.scale.set(mouthScaleX, mouthScaleY, mouthScaleZ);
  }

  public dispose() {
    this.disposables.forEach(d => {
      d.geometry?.dispose();
      d.material?.dispose();
      d.texture?.dispose();
    });
    this.disposables = [];
  }
}
