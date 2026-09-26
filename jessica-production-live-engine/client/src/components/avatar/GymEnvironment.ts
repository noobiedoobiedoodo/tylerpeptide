/**
 * client/src/components/avatar/GymEnvironment.ts
 * 
 * Procedural 3D Old-School / Golden Era Gym Environment.
 * Modeled after classic 1980s bodybuilding gyms (Gold's Gym Venice era).
 * Features cast-iron dumbbell racks, leather workout bench, Olympic plates,
 * dark rubber gym flooring, and dramatic overhead directional spotlighting.
 */

import * as THREE from 'three';

export class GymEnvironment {
  public group: THREE.Group;
  private disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material; texture?: THREE.Texture }[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'GoldenEraGymEnvironment';
    this.buildScene();
  }

  private buildScene() {
    // ── 1. BRIGHT ATHLETIC HARDWOOD GYM FLOOR ──────────────────────────
    const floorGeo = new THREE.PlaneGeometry(16, 16, 8, 8);
    let floorTexture: THREE.Texture | undefined;

    if (typeof document !== 'undefined') {
      const floorCanvas = document.createElement('canvas');
      floorCanvas.width = 512;
      floorCanvas.height = 512;
      const ctx = floorCanvas.getContext('2d');
      if (ctx) {
        // Warm golden maple gym floor base
        ctx.fillStyle = '#c49a6c';
        ctx.fillRect(0, 0, 512, 512);
        // Wood plank seam lines
        ctx.strokeStyle = '#a67c4e';
        ctx.lineWidth = 3;
        for (let y = 0; y < 512; y += 64) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(512, y);
          ctx.stroke();
          // Staggered plank joints
          const offset = (y / 64) % 2 === 0 ? 0 : 128;
          for (let x = offset; x < 512; x += 256) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + 64);
            ctx.stroke();
          }
        }
        // Subtle wood grain variation
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        for (let i = 0; i < 2500; i++) {
          const x = Math.random() * 512;
          const y = Math.random() * 512;
          ctx.fillRect(x, y, 3, 1);
        }
      }
      floorTexture = new THREE.CanvasTexture(floorCanvas);
      floorTexture.wrapS = THREE.RepeatWrapping;
      floorTexture.wrapT = THREE.RepeatWrapping;
      floorTexture.repeat.set(4, 4);
    }

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xd4aa7d,
      map: floorTexture || null,
      roughness: 0.35,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposables.push({ geometry: floorGeo, material: floorMat, texture: floorTexture });

    // ── 2. BRIGHT LOFT GYM WALL & MIRROR PANELS ─────────────────────────
    const wallGeo = new THREE.PlaneGeometry(16, 9);
    let wallTexture: THREE.Texture | undefined;

    if (typeof document !== 'undefined') {
      const wallCanvas = document.createElement('canvas');
      wallCanvas.width = 512;
      wallCanvas.height = 512;
      const wallCtx = wallCanvas.getContext('2d');
      if (wallCtx) {
        // Bright off-white painted industrial brick
        wallCtx.fillStyle = '#e8ecf2';
        wallCtx.fillRect(0, 0, 512, 512);
        // Mortar lines
        wallCtx.strokeStyle = '#cbd5e1';
        wallCtx.lineWidth = 2;
        for (let y = 0; y < 512; y += 32) {
          const offset = (y / 32) % 2 === 0 ? 0 : 32;
          for (let x = -32; x < 512; x += 64) {
            wallCtx.strokeRect(x + offset, y, 62, 30);
          }
        }
      }
      wallTexture = new THREE.CanvasTexture(wallCanvas);
      wallTexture.wrapS = THREE.RepeatWrapping;
      wallTexture.wrapT = THREE.RepeatWrapping;
      wallTexture.repeat.set(3, 2);
    }

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      map: wallTexture || null,
      roughness: 0.75,
      metalness: 0.05
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 3.3, -3.8);
    backWall.receiveShadow = true;
    this.group.add(backWall);
    this.disposables.push({ geometry: wallGeo, material: wallMat, texture: wallTexture });

    // Wide Gym Mirrors across the back wall (hallmark of bodybuilding gyms)
    const mirrorGeo = new THREE.PlaneGeometry(9.5, 3.2);
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.1,
      metalness: 0.85
    });
    const mirror = new THREE.Mesh(mirrorGeo, mirrorMat);
    mirror.position.set(0, 1.4, -3.74);
    this.group.add(mirror);
    this.disposables.push({ geometry: mirrorGeo, material: mirrorMat });

    // Mirror Chrome Frame Border
    const frameGeo = new THREE.BoxGeometry(9.6, 0.06, 0.04);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const topFrame = new THREE.Mesh(frameGeo, frameMat);
    topFrame.position.set(0, 3.02, -3.73);
    const botFrame = new THREE.Mesh(frameGeo, frameMat);
    botFrame.position.set(0, -0.22, -3.73);
    this.group.add(topFrame, botFrame);
    this.disposables.push({ geometry: frameGeo, material: frameMat });

    // Golden Era Athletics Gym Emblem Banner (High contrast gold & slate)
    const bannerGeo = new THREE.PlaneGeometry(3.6, 0.95);
    let bannerTex: THREE.Texture | undefined;

    if (typeof document !== 'undefined') {
      const bannerCanvas = document.createElement('canvas');
      bannerCanvas.width = 512;
      bannerCanvas.height = 144;
      const bCtx = bannerCanvas.getContext('2d');
      if (bCtx) {
        bCtx.fillStyle = '#0f172a';
        bCtx.fillRect(0, 0, 512, 144);
        bCtx.strokeStyle = '#f59e0b'; // Vibrant Golden Era Gold
        bCtx.lineWidth = 6;
        bCtx.strokeRect(8, 8, 496, 128);
        bCtx.fillStyle = '#fbbf24';
        bCtx.font = 'bold 36px Impact, sans-serif';
        bCtx.textAlign = 'center';
        bCtx.fillText('GOLDEN ERA ATHLETICS', 256, 58);
        bCtx.font = 'bold 18px Arial, sans-serif';
        bCtx.fillStyle = '#f8fafc';
        bCtx.fillText('HARDCORE IRON & PHYSIQUE • EST. 1982', 256, 98);
      }
      bannerTex = new THREE.CanvasTexture(bannerCanvas);
    }

    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: bannerTex || null,
      roughness: 0.35,
      metalness: 0.2
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 3.65, -3.72);
    this.group.add(banner);
    this.disposables.push({ geometry: bannerGeo, material: bannerMat, texture: bannerTex });

    // ── 3. CAST-IRON DUMBBELL RACK (LEFT BACKGROUND) ────────────────────
    const rackGroup = new THREE.Group();
    rackGroup.position.set(-2.5, -1.2, -2.2);
    rackGroup.rotation.y = 0.35; // Slight angle toward camera

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      metalness: 0.8,
      roughness: 0.35
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x111215,
      metalness: 0.7,
      roughness: 0.6
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8d8d8,
      metalness: 0.95,
      roughness: 0.15
    });

    // Uprights & Shelves
    const uprightGeo = new THREE.BoxGeometry(0.08, 1.1, 0.08);
    const shelfGeo = new THREE.BoxGeometry(2.4, 0.05, 0.35);

    const upLeft = new THREE.Mesh(uprightGeo, steelMat);
    upLeft.position.set(-1.1, 0.55, 0);
    const upRight = new THREE.Mesh(uprightGeo, steelMat);
    upRight.position.set(1.1, 0.55, 0);

    const shelf1 = new THREE.Mesh(shelfGeo, steelMat);
    shelf1.position.set(0, 0.45, 0.05);
    shelf1.rotation.x = -0.15; // Angled dumbbell shelf

    const shelf2 = new THREE.Mesh(shelfGeo, steelMat);
    shelf2.position.set(0, 0.95, -0.05);
    shelf2.rotation.x = -0.15;

    rackGroup.add(upLeft, upRight, shelf1, shelf2);
    this.disposables.push({ geometry: uprightGeo, material: steelMat });
    this.disposables.push({ geometry: shelfGeo });

    // Place Dumbbells on Shelves
    const dumbbellGeo = this.createDumbbellGeometry();
    const dbWeights = [-0.9, -0.45, 0.0, 0.45, 0.9];
    dbWeights.forEach((xPos) => {
      // Lower shelf (heavy dumbbells)
      const db1 = this.createDumbbellMesh(dumbbellGeo, ironMat, chromeMat, 1.2);
      db1.position.set(xPos, 0.53, 0.05);
      db1.rotation.y = 0.05;
      rackGroup.add(db1);

      // Upper shelf (medium dumbbells)
      const db2 = this.createDumbbellMesh(dumbbellGeo, ironMat, chromeMat, 0.9);
      db2.position.set(xPos, 1.03, -0.05);
      db2.rotation.y = -0.05;
      rackGroup.add(db2);
    });

    this.group.add(rackGroup);

    // ── 4. LEATHER UTILITY BENCH (RIGHT BACKGROUND) ─────────────────────
    const benchGroup = new THREE.Group();
    benchGroup.position.set(2.4, -1.2, -2.0);
    benchGroup.rotation.y = -0.4;

    // Bench Steel Frame
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12);
    const bLeg1 = new THREE.Mesh(legGeo, steelMat);
    bLeg1.position.set(-0.7, 0.3, 0);
    const bLeg2 = new THREE.Mesh(legGeo, steelMat);
    bLeg2.position.set(0.7, 0.3, 0);

    const spineGeo = new THREE.BoxGeometry(1.6, 0.06, 0.08);
    const bSpine = new THREE.Mesh(spineGeo, steelMat);
    bSpine.position.set(0, 0.57, 0);

    // Leather Pad
    const padGeo = new THREE.BoxGeometry(1.8, 0.1, 0.38);
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x141518,
      roughness: 0.65,
      metalness: 0.2
    });
    const pad = new THREE.Mesh(padGeo, leatherMat);
    pad.position.set(0, 0.65, 0);
    pad.castShadow = true;
    pad.receiveShadow = true;

    benchGroup.add(bLeg1, bLeg2, bSpine, pad);
    this.group.add(benchGroup);
    this.disposables.push({ geometry: legGeo });
    this.disposables.push({ geometry: spineGeo });
    this.disposables.push({ geometry: padGeo, material: leatherMat });

    // ── 5. STACKED 45 LB CAST-IRON OLYMPIC PLATES ───────────────────────
    const plateGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 24);
    for (let i = 0; i < 4; i++) {
      const plate = new THREE.Mesh(plateGeo, ironMat);
      plate.position.set(1.4, -1.17 + i * 0.062, -2.8);
      plate.rotation.y = i * 0.4;
      plate.castShadow = true;
      this.group.add(plate);
    }
    this.disposables.push({ geometry: plateGeo });

    // ── 6. BRIGHT HIGH-BAY GYM LIGHTING FIXTURES ───────────────────────
    // Physical Overhead LED Light Bars
    const lightBarGeo = new THREE.BoxGeometry(3.2, 0.08, 0.25);
    const lightBarMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.2,
      roughness: 0.1
    });

    const lightBar1 = new THREE.Mesh(lightBarGeo, lightBarMat);
    lightBar1.position.set(-1.8, 4.2, 0.2);
    const lightBar2 = new THREE.Mesh(lightBarGeo, lightBarMat);
    lightBar2.position.set(1.8, 4.2, 0.2);
    this.group.add(lightBar1, lightBar2);
    this.disposables.push({ geometry: lightBarGeo, material: lightBarMat });

    // Main Overhead Directional Light (Simulating bright gym high-bay panels)
    const overheadLight = new THREE.DirectionalLight(0xffffff, 2.6);
    overheadLight.position.set(0, 6.5, 2.5);
    overheadLight.castShadow = true;
    overheadLight.shadow.mapSize.width = 1024;
    overheadLight.shadow.mapSize.height = 1024;
    overheadLight.shadow.camera.near = 1;
    overheadLight.shadow.camera.far = 12;
    this.group.add(overheadLight);

    // Key Spotlight: Warm focused beam illuminating character chest & arms
    const keySpot = new THREE.SpotLight(0xfff7ed, 3.2, 16, Math.PI / 3.5, 0.4, 1.0);
    keySpot.position.set(1.5, 4.5, 3.5);
    keySpot.target.position.set(0, 0.2, 0);
    keySpot.castShadow = true;
    this.group.add(keySpot);
    this.group.add(keySpot.target);

    // Left Fill Light: Soft daylight fill
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.6);
    fillLight.position.set(-3.0, 3.5, 2.0);
    this.group.add(fillLight);

    // Ground Bounce Light: Warm floor reflection upward on muscles and beak
    const bounceLight = new THREE.DirectionalLight(0xfef3c7, 1.0);
    bounceLight.position.set(0, -2.0, 2.0);
    this.group.add(bounceLight);

    // Ambient Light: Bright clean daylight fill ensuring zero dark shadows
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.2);
    this.group.add(ambientLight);
  }

  private createDumbbellGeometry(): { head: THREE.CylinderGeometry; bar: THREE.CylinderGeometry } {
    const head = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16);
    const bar = new THREE.CylinderGeometry(0.02, 0.02, 0.24, 12);
    this.disposables.push({ geometry: head }, { geometry: bar });
    return { head, bar };
  }

  private createDumbbellMesh(
    geo: { head: THREE.CylinderGeometry; bar: THREE.CylinderGeometry },
    ironMat: THREE.Material,
    chromeMat: THREE.Material,
    scale: number
  ): THREE.Group {
    const db = new THREE.Group();
    db.scale.set(scale, scale, scale);

    const bar = new THREE.Mesh(geo.bar, chromeMat);
    bar.rotation.z = Math.PI / 2;

    const leftHead = new THREE.Mesh(geo.head, ironMat);
    leftHead.position.x = -0.12;
    leftHead.rotation.z = Math.PI / 2;
    leftHead.castShadow = true;

    const rightHead = new THREE.Mesh(geo.head, ironMat);
    rightHead.position.x = 0.12;
    rightHead.rotation.z = Math.PI / 2;
    rightHead.castShadow = true;

    db.add(bar, leftHead, rightHead);
    return db;
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
