import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import { ActiveSession } from './types';
import { clearTTSQueue } from './services/audioPipeline';

export const activeSessions = new Map<string, ActiveSession>();

// Rate limiting for emotion detection
let lastEmotionRequest = 0;
const EMOTION_REQUEST_INTERVAL = 1000; // 1 second

async function processVideoFrame(frameData: string, sessionId: string): Promise<void> {
  const currentTime = Date.now();
  
  // Rate limit emotion processing
  if (currentTime - lastEmotionRequest < EMOTION_REQUEST_INTERVAL) {
    return;
  }
  
  try {
    // Extract base64 data
    const base64Data = frameData.includes(',') ? frameData.split(',')[1] : frameData;
    
    if (!base64Data) {
      console.warn('Invalid frame data for emotion processing');
      return;
    }
    
    lastEmotionRequest = currentTime;
    
    // Send to emotion server
    const response = await axios.post('http://localhost:5139/detect', {
      image_base64: base64Data
    }, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
          // Reduced logging - removed verbose response logging
    
    if (response.status === 200 && response.data.success && response.data.detections?.length > 0) {
      const detection = response.data.detections[0];
      let emotionText = detection.emotion;
      
      // Extract just the emotion name (remove confidence if present)
      const emotionName = emotionText.split('(')[0].trim().toLowerCase();
      
      // Map emotion names
      const emotionMap: Record<string, string> = {
        'anger': 'angry',
        'contempt': 'disgusted',
        'disgust': 'disgusted',
        'fear': 'fearful',
        'happy': 'happy',
        'neutral': 'neutral',
        'sad': 'sad',
        'surprise': 'surprised'
      };
      
      const mappedEmotion = emotionMap[emotionName] || emotionName;
      
      // Update session emotion
      const session = activeSessions.get(sessionId);
      if (session) {
        const timestamp = Date.now();
        
        // Always update current emotion and history
        if (session.emotion !== mappedEmotion) {
          session.emotion = mappedEmotion as any;
          
          session.emotionHistory.push({ 
            emotion: mappedEmotion as any, 
            timestamp 
          });
          
          // Keep only last 10 emotions
          if (session.emotionHistory.length > 10) {
            session.emotionHistory = session.emotionHistory.slice(-10);
          }
          
          console.log(`🎭 Emotion updated: ${mappedEmotion} (recording: ${session.isRecording})`);
          
          // Send emotion update to client
          session.ws.send(JSON.stringify({
            type: 'emotion_update',
            emotion: mappedEmotion
          }));
        }
        
        // If recording, also store in recording emotions (even if same emotion)
        if (session.isRecording) {
          session.recordingEmotions.push({
            emotion: mappedEmotion as any,
            timestamp
          });
          console.log(`📹 Recording emotion: ${mappedEmotion} (total during recording: ${session.recordingEmotions.length})`);
        }
        
        // If playing TTS, store in playback emotions
        if (session.isPlayingTTS) {
          session.playbackEmotions.push({
            emotion: mappedEmotion as any,
            timestamp
          });
          console.log(`🔊 Playback emotion: ${mappedEmotion} (total during playback: ${session.playbackEmotions.length})`);
        }
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('Emotion server not running on localhost:5139');
      } else {
        console.error('Emotion server error:', error.message);
      }
    } else {
      console.error('Error processing video frame:', error);
    }
  }
}

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
                emotionHistory: [{ emotion: 'neutral', timestamp: Date.now() }],
                conversationHistory: [],
                recordingEmotions: [],
                playbackEmotions: [],
                lastPlaybackEmotions: [],
                isRecording: false,
                isPlayingTTS: false,
                isActive: true
              });
            }
            ws.send(JSON.stringify({ type: 'session_created', sessionId }));
            break;

          case 'video_frame':
            if (sessionId && data.frame) {
                    // Reduced logging - only log every 10th frame
      if (Math.random() < 0.1) {
        console.log(`📹 Processing video frames for session ${sessionId}`);
      }
      processVideoFrame(data.frame, sessionId);
            } else {
              console.warn('❌ Invalid video frame data:', { sessionId: !!sessionId, frame: !!data.frame });
            }
            break;

          case 'recording_start':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              session.isRecording = true;
              session.recordingEmotions = []; // Clear previous recording emotions
              console.log(`Session ${sessionId} started recording`);
            }
            break;

          case 'recording_stop':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              session.isRecording = false;
              console.log(`Session ${sessionId} stopped recording. Emotions during recording:`, session.recordingEmotions);
            }
            break;

          case 'tts_start':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              session.isPlayingTTS = true;
              session.playbackEmotions = []; // Clear for new playback
              console.log(`Session ${sessionId} started TTS playback`);
            }
            break;

          case 'tts_stop':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              session.isPlayingTTS = false;
              // Store playback emotions for next response
              session.lastPlaybackEmotions = [...session.playbackEmotions];
              console.log(`Session ${sessionId} stopped TTS playback. Emotions during playback:`, session.playbackEmotions);
            }
            break;

          case 'ping':
            console.log('🏓 Received ping from frontend');
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          case 'emotion_update':
            if (sessionId && activeSessions.has(sessionId)) {
              const session = activeSessions.get(sessionId)!;
              // Only update if emotion actually changed
              if (session.emotion !== data.emotion) {
                session.emotion = data.emotion;
                session.emotionHistory.push({ 
                  emotion: data.emotion, 
                  timestamp: Date.now() 
                });
                // Keep only last 10 emotions to prevent memory bloat
                if (session.emotionHistory.length > 10) {
                  session.emotionHistory = session.emotionHistory.slice(-10);
                }
                console.log(`Session ${sessionId} emotion updated to: ${data.emotion}`);
              }
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