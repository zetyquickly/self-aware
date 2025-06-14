import { WebSocketServer, WebSocket } from 'ws';
import { ActiveSession } from './types';
import { clearTTSQueue } from './services/audioPipeline';

export const activeSessions = new Map<string, ActiveSession>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    let sessionId: string | null = null;

    ws.on('message', (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'init':
            sessionId = data.sessionId || `session_${Date.now()}`;
            if (sessionId) {
              activeSessions.set(sessionId, {
                id: sessionId,
                ws,
                emotion: 'neutral',
                isActive: true
              });
            }
            ws.send(JSON.stringify({ type: 'session_created', sessionId }));
            break;

          case 'emotion_update':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              session.emotion = data.emotion;
            }
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      if (sessionId) {
        clearTTSQueue(sessionId);
        activeSessions.delete(sessionId);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
} 