/**
 * version.ts
 * Build telemetry and runtime version metadata for the Jessica Voice Engine.
 */

declare const __JARVIS_BUILD_TIME__: string | undefined;
declare const __JARVIS_COMMIT_SHA__: string | undefined;
declare const __JARVIS_ENV__: string | undefined;

export const JARVIS_BUILD_INFO = {
  buildTime: typeof __JARVIS_BUILD_TIME__ !== 'undefined' ? __JARVIS_BUILD_TIME__ : new Date().toISOString(),
  commitSha: typeof __JARVIS_COMMIT_SHA__ !== 'undefined' ? __JARVIS_COMMIT_SHA__ : 'v3.0.0-jessica-live',
  environment: typeof __JARVIS_ENV__ !== 'undefined' ? __JARVIS_ENV__ : 'development',
  geminiClientVersion: '3.0.0',
  audioEngineVersion: '2.5.0',
};
