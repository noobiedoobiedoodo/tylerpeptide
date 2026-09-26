/**
 * client/src/components/avatar/DuckBodybuilderCharacter.ts
 * 
 * 3D Duck Bodybuilder Character Model & Animation Controller.
 * Loads the custom GLB model: "duck_bodybuilder.glb"
 * 
 * Features:
 * - GLTFLoader with automatic bounding box normalization and shadow casting
 * - Real-time beak and jaw articulation driven by Gemini Live audio formants
 * - 4 animation states: IDLE, LISTENING, SPEAKING, TRAINING (Dumbbell Curl)
 * - Diaphragmatic breathing and torso posture sway
 * - Controlled bicep curl with immediate speech interruption mechanics
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AvatarState, VisemeWeights } from './types';

export class DuckBodybuilderCharacter {
  public group: THREE.Group;
  public state: AvatarState = 'IDLE';
  public isLoaded = false;

  // Model References
  private modelRoot: THREE.Group | null = null;
  private beakNode: THREE.Object3D | null = null;
  private bodyNode: THREE.Object3D | null = null;
  private rightArmNode: THREE.Object3D | null = null;
  private dumbbellNodes: THREE.Object3D[] = [];

  // Initial Rest Transforms
  private initialBeakPos = new THREE.Vector3();
  private initialArmRot = new THREE.Euler();
  private initialBodyScale = new THREE.Vector3(1, 1, 1);
  private initialRootPosY = -1.2;

  // Animation State Variables
  private curlProgress = 0;
  private isCurlingActive = false;
  private curlTargetReps = 3;
  private defaultModelScale = 1.0;

  constructor(onLoadCallback?: () => void) {
    this.group = new THREE.Group();
    this.group.name = 'DuckBodybuilderSpecialist';
    this.loadGLBModel(onLoadCallback);
  }

  /**
   * Loads duck_bodybuilder.glb asynchronously and normalizes scale/positioning.
   */
  private loadGLBModel(onLoadCallback?: () => void) {
    if (typeof window === 'undefined') {
      return;
    }
    const loader = new GLTFLoader();

    loader.load(
      '/duck_bodybuilder.glb',
      (gltf) => {
        const root = gltf.scene;
        this.modelRoot = root;

        // 1. Traverse all meshes to enable shadows & optimize materials for bright gym lighting
        root.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            if (mesh.material) {
              const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
              if (mat) {
                // Ensure materials have rich diffuse colors and sensible roughness for a brightly lit gym
                mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.45, 0.25, 0.65);
                if (mat.name === 'Metal' || mat.name === '04_-_Default') {
                  // Dumbbells: cast iron & knurled chrome
                  mat.metalness = 0.65;
                  mat.roughness = 0.3;
                } else {
                  // Duck body, beak, trunks: vivid diffuse response in bright gym
                  mat.metalness = 0.05;
                }
              }
            }
          }

          // Identify key animated nodes
          if (child.name === 'Object_13_12') {
            this.beakNode = child;
            this.initialBeakPos.copy(child.position);
          } else if (child.name === 'pCube2_13' || child.name === 'Object_32') {
            this.bodyNode = child;
            this.initialBodyScale.copy(child.scale);
          } else if (child.name.includes('Object_6.001') || child.name.includes('Object_6.002')) {
            if (!this.rightArmNode) {
              this.rightArmNode = child;
              this.initialArmRot.copy(child.rotation);
            }
          } else if (child.name.includes('Cylinder')) {
            this.dumbbellNodes.push(child);
          }
        });

        // 2. Rotate 180 degrees so the duck faces the camera (+Z)
        root.rotation.y = Math.PI;
        root.updateMatrixWorld(true);

        // 3. Compute exact bounding box and normalize to gym dimensions
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Target height ~2.0 meters in the gym
        const targetHeight = 2.0;
        const scale = size.y > 0 ? targetHeight / size.y : 1.0;
        this.defaultModelScale = scale;
        root.scale.set(scale, scale, scale);
        root.updateMatrixWorld(true);

        // Recompute position to center and place flush on gym floor (y = -1.2)
        box.setFromObject(root);
        box.getCenter(center);
        root.position.x = -center.x;
        root.position.z = -center.z;
        root.position.y = -box.min.y - 1.2;
        this.initialRootPosY = root.position.y;

        this.group.add(root);
        this.isLoaded = true;
        onLoadCallback?.();
      },
      undefined,
      (err) => {
        console.error('[DuckBodybuilderCharacter] Failed to load duck_bodybuilder.glb:', err);
      }
    );
  }

  /**
   * Main animation tick update.
   */
  public update(
    time: number,
    dt: number,
    userAudioLevel: number,
    agentAudioLevel: number,
    visemes?: VisemeWeights
  ) {
    if (!this.modelRoot || !this.isLoaded) return;

    // 1. State Resolution & Clean Transition
    if (userAudioLevel > 0.06) {
      if (this.isCurlingActive) {
        this.interruptCurl();
      }
      this.state = 'LISTENING';
      this.updateListening(time, dt, userAudioLevel);
    } else if (agentAudioLevel > 0.05) {
      this.state = 'SPEAKING';
      this.updateSpeaking(time, dt, agentAudioLevel, visemes);
    } else if (this.isCurlingActive) {
      this.state = 'TRAINING';
      this.updateTraining(time, dt);
    } else {
      this.state = 'IDLE';
      this.updateIdle(time, dt);
    }

    // 2. Real-Time Beak Articulation (Voice Formant Driven)
    if (visemes) {
      this.applyVisemes(visemes);
    }
  }

  /**
   * IDLE: Diaphragmatic respiratory rhythm & subtle posture sway.
   */
  private updateIdle(time: number, dt: number) {
    // Breathing cycle (4-second period)
    const breath = Math.sin(time * 1.6);
    this.modelRoot!.scale.y = THREE.MathUtils.lerp(
      this.modelRoot!.scale.y,
      this.defaultModelScale * (1.0 + breath * 0.02),
      dt * 4
    );

    // Subtle natural posture sway facing camera
    const sway = Math.sin(time * 0.8) * 0.025;
    this.modelRoot!.rotation.y = THREE.MathUtils.lerp(this.modelRoot!.rotation.y, Math.PI + sway, dt * 3);
    this.modelRoot!.rotation.x = THREE.MathUtils.lerp(this.modelRoot!.rotation.x, 0, dt * 4);
    this.modelRoot!.position.y = THREE.MathUtils.lerp(this.modelRoot!.position.y, this.initialRootPosY, dt * 4);

    // Arms in resting posture
    if (this.rightArmNode) {
      this.rightArmNode.rotation.x = THREE.MathUtils.lerp(
        this.rightArmNode.rotation.x,
        this.initialArmRot.x,
        dt * 4
      );
    }
  }

  /**
   * LISTENING: Interrupts exercise, leans forward toward camera, subtle head nods (~1.2 Hz).
   */
  private updateListening(time: number, dt: number, audioLevel: number) {
    // Forward attentive lean facing camera
    this.modelRoot!.rotation.x = THREE.MathUtils.lerp(this.modelRoot!.rotation.x, 0.06, dt * 6);
    this.modelRoot!.rotation.y = THREE.MathUtils.lerp(this.modelRoot!.rotation.y, Math.PI, dt * 6);

    // Subtle head nods when user speaks
    const nod = Math.sin(time * 3.5) * 0.04 * Math.min(1, audioLevel * 2.5);
    this.modelRoot!.position.y = THREE.MathUtils.lerp(this.modelRoot!.position.y, this.initialRootPosY + nod, dt * 6);

    // Arms steady
    if (this.rightArmNode) {
      this.rightArmNode.rotation.x = THREE.MathUtils.lerp(
        this.rightArmNode.rotation.x,
        this.initialArmRot.x,
        dt * 6
      );
    }
  }

  /**
   * SPEAKING: Real-time chest emphasis and subtle speech cadences.
   */
  private updateSpeaking(time: number, dt: number, audioLevel: number, visemes?: VisemeWeights) {
    // Chest rises with emphasis facing camera
    const speechPulse = Math.sin(time * 4.5) * 0.03 * Math.min(1, audioLevel * 3);
    this.modelRoot!.rotation.x = THREE.MathUtils.lerp(this.modelRoot!.rotation.x, 0.02 + speechPulse, dt * 8);
    this.modelRoot!.rotation.y = THREE.MathUtils.lerp(
      this.modelRoot!.rotation.y,
      Math.PI + Math.sin(time * 1.5) * 0.05,
      dt * 5
    );
    this.modelRoot!.position.y = THREE.MathUtils.lerp(this.modelRoot!.position.y, this.initialRootPosY, dt * 6);

    // Arm micro-gesturing
    if (this.rightArmNode) {
      this.rightArmNode.rotation.x = THREE.MathUtils.lerp(
        this.rightArmNode.rotation.x,
        this.initialArmRot.x + speechPulse * 2,
        dt * 6
      );
    }
  }

  /**
   * TRAINING: Controlled Dumbbell Curl (concentric lift, bicep squeeze, eccentric lowering).
   */
  private updateTraining(time: number, dt: number) {
    // Keep duck facing camera and on floor during training
    this.modelRoot!.rotation.y = THREE.MathUtils.lerp(this.modelRoot!.rotation.y, Math.PI, dt * 6);
    this.modelRoot!.position.y = THREE.MathUtils.lerp(this.modelRoot!.position.y, this.initialRootPosY, dt * 6);

    // 2.5-second curl repetition period
    this.curlProgress += dt * 0.4;
    const repPhase = this.curlProgress % 1.0;

    let curlAngle = 0;
    if (repPhase < 0.4) {
      // Concentric lift
      const liftProgress = repPhase / 0.4;
      curlAngle = THREE.MathUtils.smoothstep(liftProgress, 0, 1) * 1.6;
    } else if (repPhase < 0.55) {
      // Peak contraction squeeze
      curlAngle = 1.6 + Math.sin((repPhase - 0.4) * 20) * 0.05;
    } else {
      // Controlled eccentric lowering (negative)
      const lowerProgress = (repPhase - 0.55) / 0.45;
      curlAngle = (1.0 - THREE.MathUtils.smoothstep(lowerProgress, 0, 1)) * 1.6;
    }

    if (this.rightArmNode) {
      this.rightArmNode.rotation.x = THREE.MathUtils.lerp(
        this.rightArmNode.rotation.x,
        this.initialArmRot.x + curlAngle,
        dt * 12
      );
    }

    // Dumbbells move with arm
    this.dumbbellNodes.forEach((db) => {
      db.rotation.z = THREE.MathUtils.lerp(db.rotation.z, curlAngle * 0.5, dt * 10);
    });

    if (this.curlProgress >= this.curlTargetReps) {
      this.finishTraining();
    }
  }

  /**
   * Applies real-time viseme weights to the duck's beak and jaw.
   * Snaps shut cleanly within 50ms when audio ceases.
   */
  public applyVisemes(visemes: VisemeWeights) {
    if (!this.beakNode) return;

    const jawOpen = Math.max(0, Math.min(1, visemes.jawOpen));

    // Vertical beak depression & forward extension
    this.beakNode.position.y = this.initialBeakPos.y - jawOpen * 0.08;
    this.beakNode.position.z = this.initialBeakPos.z + jawOpen * 0.04;
    this.beakNode.scale.y = 1.0 + jawOpen * 0.35;
  }

  public triggerTraining(reps: number = 3) {
    if (this.state === 'SPEAKING' || this.state === 'LISTENING') return;
    this.isCurlingActive = true;
    this.curlProgress = 0;
    this.curlTargetReps = reps;
    this.state = 'TRAINING';
  }

  public interruptCurl() {
    this.isCurlingActive = false;
    this.curlProgress = 0;
    this.state = 'IDLE';
  }

  private finishTraining() {
    this.isCurlingActive = false;
    this.curlProgress = 0;
    this.state = 'IDLE';
  }

  public dispose() {
    if (this.modelRoot) {
      this.modelRoot.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
    }
  }
}
