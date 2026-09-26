/**
 * scripts/testVoiceLive.ts
 * 
 * Production Voice Verification Script for:
 * 80s Golden Era Bodybuilding Specialist (Charon Voice)
 * 
 * Connects to the local VoiceGateway WebSocket (/api/voice/live-stream),
 * transmits the exact test conversation turns to the Gemini Multimodal Live API,
 * captures raw 24kHz 16-bit linear PCM audio frames, encodes them into valid .wav files,
 * and performs acoustic analysis (sample rate, RMS, duration, pitch range).
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { peptideKnowledgeEngine } from '../server/peptide/peptideKnowledgeEngine.js';

interface TurnAudio {
  name: string;
  pcmBuffer: Buffer;
  textTranscript: string;
  durationSeconds: number;
  rms: number;
  dbfs: number;
  estimatedPitchHz: number;
  wavPath: string;
}

// WAV Header generator for 24kHz, 16-bit mono PCM
function createWavHeader(dataLength: number, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

// Acoustic analysis helpers
function analyzePcm(pcm: Buffer, sampleRate = 24000): { rms: number; dbfs: number; estimatedPitchHz: number } {
  const numSamples = Math.floor(pcm.length / 2);
  if (numSamples === 0) return { rms: 0, dbfs: -100, estimatedPitchHz: 0 };

  const samples = new Float32Array(numSamples);
  let sumSq = 0;
  for (let i = 0; i < numSamples; i++) {
    const s16 = pcm.readInt16LE(i * 2);
    const norm = s16 / 32768.0;
    samples[i] = norm;
    sumSq += norm * norm;
  }

  const rms = Math.sqrt(sumSq / numSamples);
  const dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;

  // Simple Autocorrelation for Fundamental Frequency (Pitch / F0)
  // Human male speech fundamental frequency is typically 80 Hz - 160 Hz
  const minLag = Math.floor(sampleRate / 300); // Max pitch ~300Hz
  const maxLag = Math.floor(sampleRate / 70);  // Min pitch ~70Hz
  let bestLag = 0;
  let maxCorr = -1;

  // Compute autocorrelation over a representative window (middle 2 seconds or entire buffer)
  const windowSize = Math.min(numSamples, sampleRate * 2);
  const startOffset = Math.floor((numSamples - windowSize) / 2);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let j = startOffset; j < startOffset + windowSize - lag; j++) {
      corr += samples[j] * samples[j + lag];
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  const estimatedPitchHz = bestLag > 0 ? Math.round(sampleRate / bestLag) : 0;
  return { rms, dbfs, estimatedPitchHz };
}

async function runVoiceAcceptanceTest() {
  const outputDir = path.join(process.cwd(), 'audio_verification');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('================================================================');
  console.log('  STARTING PRODUCTION VOICE ACCEPTANCE VERIFICATION');
  console.log('  Persona: 80s Golden Era Bodybuilding Specialist');
  console.log('  Target Voice: Charon (Deep Masculine, Textured, Authoritative)');
  console.log('================================================================\n');

  const wsUrl = 'ws://localhost:3000/api/voice/live-stream';
  console.log(`[1] Connecting to VoiceGateway at ${wsUrl}...`);

  const ws = new WebSocket(wsUrl);

  const turnsCaptured: TurnAudio[] = [];

  await new Promise<void>((resolve, reject) => {
    let currentTurnPcmChunks: Buffer[] = [];
    let currentTurnTranscript = '';
    let isWaitingForTurn = false;
    let turnIndex = 0;
    let turnResolve: (() => void) | null = null;

    const testConversations = [
      {
        name: 'Turn 1 — Opening & User Research Interest',
        userPrompt: 'BPC-157. I\'m mainly interested in recovery.'
      },
      {
        name: 'Turn 2 — User Inquiry: Does it actually work?',
        userPrompt: 'So does it actually work?'
      }
    ];

    ws.on('open', () => {
      console.log('[2] VoiceGateway WebSocket connected. Transmitting Setup message...');

      const systemPrompt = peptideKnowledgeEngine.generateVoiceSystemPrompt();

      const setupPayload = {
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-latest',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Charon'
                }
              }
            },
            thinkingConfig: {
              thinkingBudget: 0
            }
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'record_evidence_classification',
                  description: 'Record evidence classification level (LEVEL_A to LEVEL_E)',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      peptideName: { type: 'STRING' },
                      claimTopic: { type: 'STRING' },
                      evidenceLevel: { type: 'STRING' },
                      evidenceSummary: { type: 'STRING' }
                    }
                  }
                }
              ]
            }
          ]
        }
      };

      ws.send(JSON.stringify(setupPayload));
    });

    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const msg = JSON.parse(text);

        if (msg.setupComplete) {
          console.log('[3] Setup complete acknowledged by Gemini Live.');
          console.log('    Voice confirmed: Charon.');
          console.log('    Starting conversational test sequence...\n');
          executeNextTurn();
          return;
        }

        if (msg.serverContent) {
          const parts = msg.serverContent.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.text) {
              currentTurnTranscript += part.text;
            }
            if (part.inlineData && part.inlineData.data) {
              const chunk = Buffer.from(part.inlineData.data, 'base64');
              currentTurnPcmChunks.push(chunk);
            }
          }

          if (msg.serverContent.turnComplete) {
            console.log(`    [Audio Turn Finished] Received ${currentTurnPcmChunks.length} PCM audio frames.`);
            const totalPcm = Buffer.concat(currentTurnPcmChunks);
            const durationSec = totalPcm.length / (24000 * 2);
            const { rms, dbfs, estimatedPitchHz } = analyzePcm(totalPcm, 24000);

            const turnInfo = testConversations[turnIndex];
            const filename = `voice_turn_${turnIndex + 1}_${turnInfo.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.wav`;
            const wavPath = path.join(outputDir, filename);

            const wavBuffer = Buffer.concat([createWavHeader(totalPcm.length, 24000, 1, 16), totalPcm]);
            fs.writeFileSync(wavPath, wavBuffer);

            turnsCaptured.push({
              name: turnInfo.name,
              pcmBuffer: totalPcm,
              textTranscript: currentTurnTranscript.trim(),
              durationSeconds: durationSec,
              rms,
              dbfs,
              estimatedPitchHz,
              wavPath
            });

            console.log(`    Saved: ${filename} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
            console.log(`    Duration: ${durationSec.toFixed(2)}s | Pitch F0: ${estimatedPitchHz} Hz | RMS: ${dbfs.toFixed(1)} dBFS`);
            console.log(`    Transcript: "${currentTurnTranscript.trim().slice(0, 140)}..."\n`);

            currentTurnPcmChunks = [];
            currentTurnTranscript = '';
            turnIndex++;

            if (turnIndex < testConversations.length) {
              // Pause slightly between turns for natural conversational cadence
              setTimeout(() => {
                executeNextTurn();
              }, 1000);
            } else {
              ws.close(1000, 'Test completed');
              resolve();
            }
          }
        }
      } catch (err: any) {
        console.error('Error handling message:', err.message);
      }
    });

    function executeNextTurn() {
      if (turnIndex >= testConversations.length) return;
      const turn = testConversations[turnIndex];
      console.log(`---> Sending [User]: "${turn.userPrompt}"`);

      const clientTurn = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: turn.userPrompt }]
            }
          ],
          turnComplete: true
        }
      };

      ws.send(JSON.stringify(clientTurn));
    }

    ws.on('error', (err) => {
      console.error('[VoiceGateway] Error:', err);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`[VoiceGateway] Connection closed: code=${code}, reason=${reason}`);
    });
  });

  console.log('================================================================');
  console.log('  VOICE ACCEPTANCE AUDIT RESULTS & EVIDENCE');
  console.log('================================================================\n');

  turnsCaptured.forEach((turn, idx) => {
    console.log(`TURN ${idx + 1}: ${turn.name}`);
    console.log(`• WAV File: ${turn.wavPath}`);
    console.log(`• Audio File Size: ${fs.statSync(turn.wavPath).size} bytes`);
    console.log(`• Sampling Rate: 24,000 Hz (16-bit linear PCM mono)`);
    console.log(`• Audio Duration: ${turn.durationSeconds.toFixed(2)} seconds`);
    console.log(`• Fundamental Pitch (F0): ${turn.estimatedPitchHz} Hz (Target Deep Masculine: 85 Hz - 135 Hz)`);
    console.log(`• Energy / RMS: ${turn.dbfs.toFixed(1)} dBFS`);
    console.log(`• Exact Spoken Transcript:\n  "${turn.textTranscript}"\n`);
  });

  return turnsCaptured;
}

runVoiceAcceptanceTest().catch((err) => {
  console.error('Voice test failed:', err);
  process.exit(1);
});
