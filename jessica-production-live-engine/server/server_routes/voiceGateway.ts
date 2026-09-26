/**
 * server_routes/voiceGateway.ts
 * 
 * Production Backend Voice Gateway for Gemini Multimodal Live API.
 * Keeps Gemini API Key 100% server-side and invisible to client/DevTools:
 * - Accepts persistent client WebSocket connections at /api/voice/live-stream
 * - Establishes direct persistent WebSocket to Google Gemini BidiGenerateContent
 * - Bidirectionally proxies raw 16kHz PCM audio & 24kHz audio frames with zero buffering delay
 * - Transparently forwards close codes and protocol frames
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';

export function setupVoiceGateway(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const host = request.headers.host || 'localhost';
    const parsedUrl = new URL(request.url || '', `http://${host}`);
    
    if (parsedUrl.pathname === '/api/voice/live-stream') {
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        wss.emit('connection', clientWs, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket, request: IncomingMessage) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[VoiceGateway] GEMINI_API_KEY is not configured on the server.');
      clientWs.close(1011, 'GEMINI_API_KEY_NOT_CONFIGURED');
      return;
    }

    const host = request.headers.host || 'localhost';
    const parsedUrl = new URL(request.url || '', `http://${host}`);
    const requestedModel = parsedUrl.searchParams.get('model') || process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest';

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const geminiWs = new WebSocket(geminiUrl);

    const pendingQueue: Array<{ data: any; isBinary: boolean }> = [];
    let isGeminiOpen = false;

    geminiWs.on('open', () => {
      isGeminiOpen = true;
      while (pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (item && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(item.data, { binary: item.isBinary });
        }
      }
    });

    clientWs.on('message', (data, isBinary) => {
      if (isGeminiOpen && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(data, { binary: isBinary });
      } else if (!isGeminiOpen && geminiWs.readyState === WebSocket.CONNECTING) {
        pendingQueue.push({ data, isBinary });
      }
    });

    geminiWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    clientWs.on('close', (code, reason) => {
      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
        try { geminiWs.close(code, reason); } catch {}
      }
    });

    clientWs.on('error', (err) => {
      console.warn('[VoiceGateway] Client socket error:', err.message);
      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
        try { geminiWs.close(1011, 'Client error'); } catch {}
      }
    });

    geminiWs.on('close', (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        try { clientWs.close(code, reason); } catch {}
      }
    });

    geminiWs.on('error', (err) => {
      console.error('[VoiceGateway] Gemini upstream socket error:', err.message);
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        try { clientWs.close(1011, 'Gemini connection error'); } catch {}
      }
    });
  });

  return wss;
}
