/**
 * scripts/verifyProductionVoiceWithAudio.ts
 * 
 * Exhaustive Audio & Persona Verification for:
 * 80s Golden Era Bodybuilding Specialist (Charon Voice)
 * 
 * Generates and captures authentic 24kHz audio from Gemini Live Native Voice Engine,
 * performs acoustic pitch analysis, transcribes the spoken speech, and saves playable .wav files.
 */

import 'dotenv/config';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { peptideKnowledgeEngine } from '../server/peptide/peptideKnowledgeEngine.js';

function createWavHeader(dataLength: number, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function analyzeAcoustics(pcm: Buffer, sampleRate = 24000) {
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

  const minLag = Math.floor(sampleRate / 300); // 300Hz max
  const maxLag = Math.floor(sampleRate / 70);  // 70Hz min
  let bestLag = 0;
  let maxCorr = -1;

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

async function transcribeWav(wavBuffer: Buffer, apiKey: string): Promise<string> {
  try {
    const base64Audio = wavBuffer.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe the spoken speech in this audio recording verbatim. Output only the exact transcribed words, nothing else."
              },
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Audio
                }
              }
            ]
          }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return `[Transcription API error: ${resp.status} - ${errText}]`;
    }

    const json = await resp.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[No transcription returned]';
  } catch (err: any) {
    return `[Transcription failed: ${err.message}]`;
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing from environment.');
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), 'audio_verification');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('========================================================================');
  console.log('  PRODUCING & VERIFYING PRODUCTION AUDIO FOR EXACT USER TEST SCRIPT');
  console.log('  Voice Character: 80s Golden Era Bodybuilder (Charon Voice)');
  console.log('  Engine: Gemini 2.5 Native Multimodal Live Audio (24kHz Mono)');
  console.log('========================================================================\n');

  const testSteps = [
    {
      stepId: 'TEST-SCRIPT-01',
      title: 'Opening Greeting',
      instruction: `Speak this opening message to the lifter with your deep, authoritative, textured 1980s Golden Era bodybuilding coach voice. Maintain steady, unhurried pacing with calm intensity: "Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?"`
    },
    {
      stepId: 'TEST-SCRIPT-02',
      title: 'Turn 1 — BPC-157 Community First',
      instruction: `The lifter says: "What can you tell me about BPC-157?" Speak this exact response in your deep, masculine 80s Golden Era coach voice, leading with community perspective, lifter disclaimer, and offering research: "In the bodybuilding and physique community, BPC-157 has gotten a ton of attention over the last few years. Lifters mostly look at it when they're dealing with nagging joint issues, tendon flare-ups, elbows, knees, shoulders, or trying to bounce back from heavy training sessions. That said, what you hear in the gym is community experience, not clinical proof. If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?"`
    },
    {
      stepId: 'TEST-SCRIPT-03',
      title: 'Turn 2 — Preclinical Research Request',
      instruction: `The lifter says: "Tell me about the preclinical research." Deliver this response with calm, experienced authority, maintaining strict scientific discipline without hype: "Alright, let's look at the science. In animal and laboratory models, BPC-157 has been investigated for soft tissue repair, tendon and ligament healing, and blood vessel formation. But keep in mind: animal and cell studies do not prove the same effect happens in humans. If you want to see what human clinical trials exist, or continue with the peptide team on WhatsApp, let me know."`
    }
  ];

  const results: any[] = [];

  for (const step of testSteps) {
    console.log(`>>> Executing ${step.stepId}: ${step.title}...`);

    const pcmChunks: Buffer[] = [];
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        const setupMessage = {
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
              parts: [{ text: peptideKnowledgeEngine.generateVoiceSystemPrompt() }]
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const str = typeof data === 'string' ? data : data.toString('utf-8');
          const msg = JSON.parse(str);

          if (msg.setupComplete) {
            // Send client prompt
            const promptMsg = {
              clientContent: {
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: step.instruction }]
                  }
                ],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(promptMsg));
            return;
          }

          if (msg.serverContent) {
            const parts = msg.serverContent.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                pcmChunks.push(Buffer.from(part.inlineData.data, 'base64'));
              }
            }

            if (msg.serverContent.turnComplete) {
              ws.close(1000, 'Done');
              resolve();
            }
          }
        } catch (e: any) {
          console.error('Error handling message:', e.message);
        }
      });

      ws.on('error', (err) => {
        console.error('WebSocket error on step', step.stepId, err.message);
        reject(err);
      });
    });

    const totalPcm = Buffer.concat(pcmChunks);
    const durationSeconds = totalPcm.length / (24000 * 2);
    const { rms, dbfs, estimatedPitchHz } = analyzeAcoustics(totalPcm, 24000);
    const wavHeader = createWavHeader(totalPcm.length, 24000, 1, 16);
    const fullWav = Buffer.concat([wavHeader, totalPcm]);

    const filename = `${step.stepId.toLowerCase()}_${step.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.wav`;
    const fullPath = path.join(outputDir, filename);
    fs.writeFileSync(fullPath, fullWav);

    console.log(`    Captured ${pcmChunks.length} frames | ${durationSeconds.toFixed(2)}s | Pitch F0: ${estimatedPitchHz} Hz | RMS: ${dbfs.toFixed(1)} dBFS`);
    console.log(`    Transcribing spoken audio via Gemini Vision/Audio API...`);

    const transcript = await transcribeWav(fullWav, apiKey);
    console.log(`    Spoken Transcript: "${transcript}"\n`);

    results.push({
      stepId: step.stepId,
      title: step.title,
      filename,
      filePath: fullPath,
      fileSize: fullWav.length,
      durationSeconds,
      estimatedPitchHz,
      dbfs,
      transcript
    });
  }

  console.log('========================================================================');
  console.log('  FINAL PRODUCTION VOICE VERIFICATION REPORT');
  console.log('========================================================================\n');

  results.forEach(r => {
    console.log(`● [${r.stepId}] ${r.title}`);
    console.log(`  File: ${r.filePath}`);
    console.log(`  Size: ${r.fileSize} bytes | Format: WAV (24kHz, 16-bit Mono PCM)`);
    console.log(`  Duration: ${r.durationSeconds.toFixed(2)} seconds`);
    console.log(`  Pitch F0: ${r.estimatedPitchHz} Hz (Target Deep Masculine: 85-135 Hz)`);
    console.log(`  Signal Level: ${r.dbfs.toFixed(1)} dBFS`);
    console.log(`  Verbatim Transcription:`);
    console.log(`  "${r.transcript}"\n`);
  });
}

main().catch(err => {
  console.error('Fatal error in voice verification:', err);
  process.exit(1);
});
