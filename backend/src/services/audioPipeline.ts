import { config } from 'dotenv';
config(); // Load environment variables

import { createClient, DeepgramClient } from '@deepgram/sdk';
import axios from 'axios';
import Resemble from '@resemble/node';
import { activeSessions } from '../websocket';
import { PipelineResult } from '../types';
import fs from 'fs';
import path from 'path';

// TTS Queue management
interface TTSQueueItem {
  sentence: string;
  sessionId: string;
  timestamp: number;
}

const ttsQueues = new Map<string, TTSQueueItem[]>();
const processingTTS = new Map<string, boolean>();

let deepgram: DeepgramClient | null = null;

// Logging function for Inflection responses
function logInflectionResponse(sessionId: string, prompt: string, response: string, isStreaming: boolean = false): void {
  const logDir = path.join(process.cwd(), 'logs');
  const logFile = path.join(logDir, 'inflection-responses.log');
  
  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    sessionId,
    prompt,
    response,
    isStreaming,
    responseLength: response.length
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  try {
    fs.appendFileSync(logFile, logLine);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

// Logging function for streaming chunks (for detailed debugging)
function logStreamingChunk(sessionId: string, chunk: string, fullResponse: string): void {
  const logDir = path.join(process.cwd(), 'logs');
  const logFile = path.join(logDir, 'inflection-streaming.log');
  
  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    sessionId,
    chunk,
    fullResponseSoFar: fullResponse,
    chunkLength: chunk.length,
    totalLength: fullResponse.length
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  try {
    fs.appendFileSync(logFile, logLine);
  } catch (error) {
    console.error('Failed to write to streaming log file:', error);
  }
}

function getDeepgramClient(): DeepgramClient {
  if (!deepgram) {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
  }
  return deepgram;
}

function initResemble(): void {
  Resemble.Resemble.setApiKey(process.env.RESEMBLE_API_KEY!);
}

// Queue management functions
function addToTTSQueue(sentence: string, sessionId: string): void {
  if (!ttsQueues.has(sessionId)) {
    ttsQueues.set(sessionId, []);
  }
  
  const queue = ttsQueues.get(sessionId)!;
  queue.push({
    sentence,
    sessionId,
    timestamp: Date.now()
  });
  
  // Start processing if not already processing
  if (!processingTTS.get(sessionId)) {
    processTTSQueue(sessionId);
  }
}

async function processTTSQueue(sessionId: string): Promise<void> {
  if (processingTTS.get(sessionId)) {
    return; // Already processing
  }
  
  processingTTS.set(sessionId, true);
  const queue = ttsQueues.get(sessionId);
  
  if (!queue) {
    processingTTS.set(sessionId, false);
    return;
  }
  
  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      await generateTTSForSentence(item.sentence, item.sessionId);
      // Add a small delay between audio chunks to prevent overlap
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error processing TTS queue item:', error);
    }
  }
  
  processingTTS.set(sessionId, false);
}

export function clearTTSQueue(sessionId: string): void {
  ttsQueues.delete(sessionId);
  processingTTS.delete(sessionId);
}

function getEmotionContext(session: any): string {
  if (!session?.emotionHistory || session.emotionHistory.length <= 1) {
    return '';
  }
  
  const recentEmotions = session.emotionHistory.slice(-3); // Last 3 emotions
  const emotionSummary = recentEmotions
    .map((e: any) => e.emotion)
    .join(' → ');
  
  return `Recent emotion progression: ${emotionSummary}.`;
}

export async function listResembleVoices(): Promise<void> {
  try {
    initResemble();
    const response = await Resemble.Resemble.v2.voices.all(1, 50);
    
    if ('success' in response && response.success && 'items' in response) {
      console.log('Available Resemble voices:');
      response.items.forEach((voice: any) => {
        console.log(`- ${voice.name} (UUID: ${voice.uuid})`);
      });
    } else {
      console.error('Failed to fetch voices:', response);
    }
  } catch (error) {
    console.error('Error fetching voices:', error);
  }
}

export async function processAudioPipeline(
  audioBuffer: Buffer,
  sessionId: string
): Promise<PipelineResult> {
  const session = activeSessions.get(sessionId);
  
  // Clear any existing TTS queue for this session
  clearTTSQueue(sessionId);
  
  try {
    // Step 1: Deepgram STT (non-streamed)
    console.log('Starting Deepgram transcription...');
    const transcription = await transcribeWithDeepgram(audioBuffer);
    
    // Send transcription to client
    if (session?.ws) {
      session.ws.send(JSON.stringify({
        type: 'transcription',
        text: transcription,
        timestamp: new Date().toISOString()
      }));
    }

    // Step 2: Send to Inflection API (streaming)
    console.log('Sending to Inflection API...');
    const inflectionResponse = await streamInflectionResponse(transcription, sessionId);

    // Step 3: TTS is handled during streaming, no need to process again

    return {
      transcription,
      response: inflectionResponse
    };
  } catch (error) {
    console.error('Pipeline error:', error);
    throw error;
  }
}

async function transcribeWithDeepgram(audioBuffer: Buffer): Promise<string> {
  try {
    const client = getDeepgramClient();
    const { result } = await client.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: process.env.DEEPGRAM_MODEL || 'nova-2',
        language: process.env.DEEPGRAM_LANGUAGE || 'en-US',
        punctuate: true,
        smart_format: true
      }
    );

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return transcript;
  } catch (error) {
    console.error('Deepgram error:', error);
    throw new Error('Failed to transcribe audio');
  }
}

async function streamInflectionResponse(
  prompt: string,
  sessionId: string
): Promise<string> {
  const session = activeSessions.get(sessionId);
  let fullResponse = '';
  let currentSentence = '';
  const processedSentences = new Set<string>(); // Track processed sentences

  // Add user message to conversation history
  if (session) {
    session.conversationHistory.push({
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    });
    
    // Keep only last 20 messages (10 exchanges)
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }
  }

  try {
    // Build messages array with conversation history
    const messages = [
      {
        role: 'system',
        content: `You are Pi, a helpful AI assistant. Be conversational and concise. No emojis.

The user's current emotion is: ${session?.emotion || 'neutral'}. ${getEmotionContext(session)}

Respond naturally based on their emotion - be supportive if sad, calm if angry, enthusiastic if happy, etc.`
      }
    ];

    // Add conversation history (last 10 messages)
    if (session?.conversationHistory && session.conversationHistory.length > 0) {
      const recentHistory = session.conversationHistory.slice(-10);
      messages.push(...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    } else {
      // If no history, add the current prompt
      messages.push({
        role: 'user',
        content: prompt
      });
    }

    // Use the correct Inflection API endpoint from the OpenAPI spec
    const response = await axios.post(
      'https://api.inflection.ai/v1/chat/completions',
      {
        model: 'Pi-3.1',
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 150
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.INFLECTION_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream'
      }
    );

    // Process Server-Sent Events stream
    response.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            // Stream finished
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            
                         if (content) {
               fullResponse += content;
               currentSentence += content;
               
               // Log the streaming chunk
               logStreamingChunk(sessionId, content, fullResponse);
               
               // Send incremental updates with just the new content
               if (session?.ws) {
                 session.ws.send(JSON.stringify({
                   type: 'response_chunk',
                   text: content, // Send only the new chunk, not accumulated
                   fullText: fullResponse, // Include full text for context
                   emotion: session.emotion,
                   timestamp: new Date().toISOString()
                 }));
               }
              
                             // Check for sentence end to generate TTS
               if (content.match(/[.!?]/)) {
                 const sentence = currentSentence.trim();
                 if (sentence && !processedSentences.has(sentence)) {
                   processedSentences.add(sentence);
                   // Add to TTS queue instead of generating immediately
                   addToTTSQueue(sentence, sessionId);
                 }
                 currentSentence = '';
               }
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError);
          }
        }
      }
    });

         response.data.on('end', () => {
       // Generate TTS for any remaining content
       const sentence = currentSentence.trim();
       if (sentence && !processedSentences.has(sentence)) {
         processedSentences.add(sentence);
         // Add to TTS queue instead of generating immediately
         addToTTSQueue(sentence, sessionId);
       }
     });

    response.data.on('error', (error: Error) => {
      console.error('Stream error:', error);
      throw error;
    });

    // Wait for stream to complete
    await new Promise((resolve, reject) => {
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    // Add assistant response to conversation history
    if (session && fullResponse.trim()) {
      session.conversationHistory.push({
        role: 'assistant',
        content: fullResponse.trim(),
        timestamp: Date.now()
      });
      
      // Keep only last 20 messages (10 exchanges)
      if (session.conversationHistory.length > 20) {
        session.conversationHistory = session.conversationHistory.slice(-20);
      }
    }

    // Log the complete response
    logInflectionResponse(sessionId, prompt, fullResponse, true);

    return fullResponse;
  } catch (error) {
    console.error('Inflection API error:', error);
    // Fallback response
    const fallbackResponse = `I understand you said: "${prompt}". How can I help you with that?`;
    
    if (session?.ws) {
      session.ws.send(JSON.stringify({
        type: 'response_chunk',
        text: fallbackResponse,
        emotion: session.emotion,
        timestamp: new Date().toISOString()
      }));
    }
    
    addToTTSQueue(fallbackResponse, sessionId);
    
    // Add fallback response to conversation history
    if (session) {
      session.conversationHistory.push({
        role: 'assistant',
        content: fallbackResponse,
        timestamp: Date.now()
      });
      
      // Keep only last 20 messages (10 exchanges)
      if (session.conversationHistory.length > 20) {
        session.conversationHistory = session.conversationHistory.slice(-20);
      }
    }
    
    // Log the fallback response
    logInflectionResponse(sessionId, prompt, fallbackResponse, false);
    
    return fallbackResponse;
  }
}

async function generateTTSForSentence(
  sentence: string,
  sessionId: string
): Promise<void> {
  const session = activeSessions.get(sessionId);
  
  try {
    // Initialize Resemble if not already done
    initResemble();
    
    // Generate audio with Resemble
    // Note: Using createSync as createAsync requires a callback_uri
    const response = await Resemble.Resemble.v2.clips.createSync(
      process.env.RESEMBLE_PROJECT_UUID!,
      {
        voice_uuid: process.env.RESEMBLE_VOICE_UUID!,
        body: sentence,
        is_archived: false
      }
    );

    // Check if response is successful and send audio to client
    if (session?.ws && 'success' in response && response.success && 'item' in response && response.item) {
      const audioUrl = response.item.audio_src;
      
      if (audioUrl) {
        try {
          // Fetch the audio data
          const audioResponse = await axios.get(audioUrl, {
            responseType: 'arraybuffer'
          });
          
          // Send audio chunk to client
          session.ws.send(JSON.stringify({
            type: 'audio_chunk',
            audio: Buffer.from(audioResponse.data).toString('base64'),
            timestamp: new Date().toISOString()
          }));
          
          session.ws.send(JSON.stringify({
            type: 'audio_complete',
            timestamp: new Date().toISOString()
          }));
        } catch (fetchError) {
          console.error('Error fetching audio:', fetchError);
        }
      }
    } else {
      console.error('Resemble API error:', response);
    }
  } catch (error) {
    console.error('Resemble TTS error:', error);
  }
}

 