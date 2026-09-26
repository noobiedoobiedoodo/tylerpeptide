/**
 * VoiceMetrics & Telemetry (Directives 1, 14, 15)
 * 
 * Records structured telemetry per voice session and conversational turn.
 */

export interface DevicePlatformInfo {
  platform: string;
  browser: string;
  browserVersion: string;
  deviceClass: 'mobile' | 'tablet' | 'desktop';
  isMobile: boolean;
  audioOutputAvailable: boolean;
}

export function detectDevicePlatform(): DevicePlatformInfo {
  if (typeof window === 'undefined') {
    return {
      platform: 'unknown',
      browser: 'node',
      browserVersion: '0',
      deviceClass: 'desktop',
      isMobile: false,
      audioOutputAvailable: false
    };
  }

  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let version = '0';
  let platform = navigator.platform || 'Unknown';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || ('ontouchstart' in window);

  if (/CriOS\/([\d\.]+)/.test(ua)) {
    browser = 'iOS Chrome';
    version = RegExp.$1;
  } else if (/FxiOS\/([\d\.]+)/.test(ua)) {
    browser = 'iOS Firefox';
    version = RegExp.$1;
  } else if (/Chrome\/([\d\.]+)/.test(ua)) {
    browser = isMobile ? 'Android Chrome' : 'Desktop Chrome';
    version = RegExp.$1;
  } else if (/Safari\/([\d\.]+)/.test(ua) && !/Chrome/.test(ua)) {
    browser = isMobile ? 'iOS Safari' : 'Desktop Safari';
    version = RegExp.$1;
  } else if (/Firefox\/([\d\.]+)/.test(ua)) {
    browser = 'Firefox';
    version = RegExp.$1;
  } else if (/Edg\/([\d\.]+)/.test(ua)) {
    browser = 'Edge';
    version = RegExp.$1;
  }

  return {
    platform,
    browser,
    browserVersion: version,
    deviceClass: isMobile ? 'mobile' : 'desktop',
    isMobile,
    audioOutputAvailable: typeof window.AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined'
  };
}
