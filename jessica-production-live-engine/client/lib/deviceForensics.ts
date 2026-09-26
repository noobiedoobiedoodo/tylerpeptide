export interface DeviceForensics {
  // Device Identity
  deviceId: string;              // Persistent UUID
  sessionId: string;             // Per-session UUID
  
  // Timestamps
  collectedAt: string;           // ISO timestamp
  pageLoadedAt: string;          // Performance timing
  
  // Browser & Platform
  userAgent: string;
  platform: string;              // navigator.platform
  vendor: string;                // navigator.vendor
  language: string;              // navigator.language
  languages: string[];           // navigator.languages
  cookiesEnabled: boolean;
  doNotTrack: boolean;
  
  // Screen & Display
  screenWidth: number;
  screenHeight: number;
  screenColorDepth: number;
  screenPixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  
  // Hardware
  cpuCores: number;              // navigator.hardwareConcurrency
  deviceMemoryGB: number | null; // navigator.deviceMemory (Chrome/Edge only)
  maxTouchPoints: number;        // Distinguishes real mobile from emulated
  
  // Connection & Network
  connectionType: string | null;       // navigator.connection.effectiveType (4g, 3g, etc)
  connectionDownlink: number | null;   // Mbps
  connectionRtt: number | null;        // ms round-trip
  
  // Battery (async, null if unsupported)
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  
  // GPU & Graphics (WebGL)
  gpuVendor: string | null;
  gpuRenderer: string | null;    // e.g. "Apple M2 Max", "NVIDIA GeForce RTX 4070"
  
  // Fingerprint Hashes (async)
  canvasHash: string | null;     // SHA-256 of canvas 2D render
  audioHash: string | null;      // SHA-256 of AudioContext oscillator output (optional, if fails set null)
  
  // Timezone & Locale (critical for VPN detection)
  timezone: string;              // Intl.DateTimeFormat().resolvedOptions().timeZone e.g. "America/Toronto"
  timezoneOffset: number;        // new Date().getTimezoneOffset() in minutes
  locale: string;                // Intl.DateTimeFormat().resolvedOptions().locale
  
  // Traffic Source
  referrer: string;
  landingUrl: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  
  // Privacy & Anonymization Signals
  isIncognito: boolean | null;   // Detected via storage quota test (null if detection fails)
  adBlockDetected: boolean | null;
  
  // Media Capabilities
  mediaDevicesCount: number | null; // Number of media devices (cameras, mics) - count only, no names
}

const DEVICE_ID_KEY = 'yna_device_id';
let cachedForensics: DeviceForensics | null = null;
const sessionId = crypto.randomUUID();

export function getDeviceId(): string {
  let id: string | null = null;

  try { id = id || localStorage.getItem(DEVICE_ID_KEY); } catch (e) {}
  try { id = id || sessionStorage.getItem(DEVICE_ID_KEY); } catch (e) {}
  if (!id) {
    try {
      const match = document.cookie.match(new RegExp('(^| )' + DEVICE_ID_KEY + '=([^;]+)'));
      if (match) id = match[2];
    } catch (e) {}
  }

  if (!id) {
    id = crypto.randomUUID();
  }

  try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
  try { sessionStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
  try { document.cookie = `${DEVICE_ID_KEY}=${id}; path=/; max-age=31536000; SameSite=Lax`; } catch (e) {}

  return id;
}

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash.toString(16);
}

function getCanvasHash(): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('YNA-Forensics-Canvas', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('YNA-Forensics-Canvas', 4, 17);

    return djb2Hash(canvas.toDataURL());
  } catch (e) {
    return null;
  }
}

async function getAudioHash(): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 200);
    try {
      const OfflineAudioContext = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      if (!OfflineAudioContext) {
        clearTimeout(timeout);
        return resolve(null);
      }
      
      const context = new OfflineAudioContext(1, 44100, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, context.currentTime);
      
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, context.currentTime);
      compressor.knee.setValueAtTime(40, context.currentTime);
      compressor.ratio.setValueAtTime(12, context.currentTime);
      compressor.attack.setValueAtTime(0, context.currentTime);
      compressor.release.setValueAtTime(0.25, context.currentTime);

      oscillator.connect(compressor);
      compressor.connect(context.destination);
      
      oscillator.start(0);
      
      context.oncomplete = (event) => {
        clearTimeout(timeout);
        const buffer = event.renderedBuffer.getChannelData(0);
        let hashStr = '';
        for (let i = 4500; i < 5000; i += 10) { // sample subset
          hashStr += buffer[i].toString();
        }
        resolve(djb2Hash(hashStr));
      };
      
      context.startRendering().catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
    } catch (e) {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

function getWebGLInfo(): { vendor: string | null, renderer: string | null } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        return {
          vendor: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
          renderer: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        };
      }
    }
  } catch (e) {}
  return { vendor: null, renderer: null };
}

async function getBatteryInfo(): Promise<{ level: number | null, charging: boolean | null }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ level: null, charging: null }), 200);
    try {
      if ('getBattery' in navigator) {
        (navigator as any).getBattery().then((battery: any) => {
          clearTimeout(timeout);
          resolve({ level: battery.level, charging: battery.charging });
        }).catch(() => {
          clearTimeout(timeout);
          resolve({ level: null, charging: null });
        });
      } else {
        clearTimeout(timeout);
        resolve({ level: null, charging: null });
      }
    } catch (e) {
      clearTimeout(timeout);
      resolve({ level: null, charging: null });
    }
  });
}

async function isIncognitoMode(): Promise<boolean | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 200);
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        navigator.storage.estimate().then(({ quota }) => {
          clearTimeout(timeout);
          // Heuristic: quota often small in incognito
          if (quota && quota < 120000000) {
            resolve(true);
          } else {
            resolve(false);
          }
        }).catch(() => {
          clearTimeout(timeout);
          resolve(null);
        });
      } else {
        clearTimeout(timeout);
        resolve(null);
      }
    } catch (e) {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

function detectAdBlocker(): boolean | null {
  try {
    const testAd = document.createElement('div');
    testAd.innerHTML = '&nbsp;';
    testAd.className = 'ad-banner';
    testAd.style.position = 'absolute';
    testAd.style.top = '-1000px';
    document.body.appendChild(testAd);
    
    const isBlocked = testAd.offsetHeight === 0 || window.getComputedStyle(testAd).display === 'none';
    
    document.body.removeChild(testAd);
    return isBlocked;
  } catch (e) {
    return null;
  }
}

async function getMediaDevicesCount(): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 200);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
          clearTimeout(timeout);
          resolve(devices.length);
        }).catch(() => {
          clearTimeout(timeout);
          resolve(null);
        });
      } else {
        clearTimeout(timeout);
        resolve(null);
      }
    } catch (e) {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

export async function collectDeviceForensics(): Promise<DeviceForensics> {
  if (cachedForensics) {
    return cachedForensics;
  }

  const deviceId = getDeviceId();
  const collectedAt = new Date().toISOString();
  let pageLoadedAt = '';
  
  if (window.performance && window.performance.timing) {
    pageLoadedAt = new Date(window.performance.timing.navigationStart).toISOString();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const utmSource = urlParams.get('utm_source');
  const utmMedium = urlParams.get('utm_medium');
  const utmCampaign = urlParams.get('utm_campaign');

  const nav = navigator as any;
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

  const webglInfo = getWebGLInfo();
  
  const [battery, audioHash, incognito, mediaDevicesCount] = await Promise.all([
    getBatteryInfo(),
    getAudioHash(),
    isIncognitoMode(),
    getMediaDevicesCount()
  ]);

  const forensics: DeviceForensics = {
    deviceId,
    sessionId,
    collectedAt,
    pageLoadedAt,
    
    userAgent: navigator.userAgent,
    platform: nav.platform || '',
    vendor: navigator.vendor || '',
    language: navigator.language || '',
    languages: [...(navigator.languages || [])],
    cookiesEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack === '1' || (window as any).doNotTrack === '1' || (navigator as any).msDoNotTrack === '1',
    
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    screenColorDepth: window.screen.colorDepth,
    screenPixelRatio: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    
    cpuCores: navigator.hardwareConcurrency || 1,
    deviceMemoryGB: nav.deviceMemory || null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    
    connectionType: connection ? connection.effectiveType : null,
    connectionDownlink: connection ? connection.downlink : null,
    connectionRtt: connection ? connection.rtt : null,
    
    batteryLevel: battery.level,
    batteryCharging: battery.charging,
    
    gpuVendor: webglInfo.vendor,
    gpuRenderer: webglInfo.renderer,
    
    canvasHash: getCanvasHash(),
    audioHash,
    
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    
    referrer: document.referrer,
    landingUrl: window.location.href,
    utmSource,
    utmMedium,
    utmCampaign,
    
    isIncognito: incognito,
    adBlockDetected: detectAdBlocker(),
    
    mediaDevicesCount
  };

  cachedForensics = forensics;
  return forensics;
}

/**
 * Collects client-side forensics AND sends to server for IP/geo/VPN enrichment.
 * Returns the full merged forensics as a JSON string ready for database storage.
 * Non-blocking - returns client-only data if server enrichment fails.
 */
let cachedEnrichedJson: string | null = null;
export async function collectAndEnrichForensics(): Promise<string> {
  if (cachedEnrichedJson) return cachedEnrichedJson;
  
  try {
    const clientData = await collectDeviceForensics();
    
    // Send to server for IP/geo/VPN enrichment
    const res = await fetch('/api/forensics/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clientData),
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.forensics) {
        cachedEnrichedJson = JSON.stringify(data.forensics);
        return cachedEnrichedJson;
      }
    }
    
    // Fallback: return client-only data
    cachedEnrichedJson = JSON.stringify(clientData);
    return cachedEnrichedJson;
  } catch {
    // If anything fails, return whatever we have
    const clientData = await collectDeviceForensics();
    cachedEnrichedJson = JSON.stringify(clientData);
    return cachedEnrichedJson;
  }
}
