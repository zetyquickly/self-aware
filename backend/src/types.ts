import { WebSocket } from 'ws';

export interface ActiveSession {
  id: string;
  ws: WebSocket;
  emotion: EmotionType;
  isActive: boolean;
}

export type EmotionType = 'happy' | 'sad' | 'angry' | 'neutral' | 'fearful' | 'disgusted' | 'surprised';

export interface TranscriptionResult {
  text: string;
  confidence: number;
}

export interface PipelineResult {
  transcription: string;
  response?: string;
  audioUrl?: string;
} 