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
  let context = '';
  
  // Helper function to get top emotions from array
  const getTopEmotions = (emotions: string[], topN: number = 3) => {
    const emotionCounts = emotions.reduce((acc: any, emotion: string) => {
      acc[emotion] = (acc[emotion] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(emotionCounts)
      .sort(([,a]: any, [,b]: any) => b - a)
      .slice(0, topN)
      .map(([emotion, count]: any) => ({
        emotion,
        percentage: Math.round((count / emotions.length) * 100)
      }));
  };
  
  // Add recording emotions (most important)
  if (session?.recordingEmotions && session.recordingEmotions.length > 0) {
    const recordingEmotions = session.recordingEmotions.map((e: any) => e.emotion);
    const topRecordingEmotions = getTopEmotions(recordingEmotions);
    
    if (topRecordingEmotions.length > 0) {
      const primary = topRecordingEmotions[0];
      context += `User's emotions while speaking: ${primary.emotion} (${primary.percentage}%)`;
      
      if (topRecordingEmotions.length > 1) {
        const others = topRecordingEmotions.slice(1)
          .map(e => `${e.emotion} (${e.percentage}%)`)
          .join(', ');
        context += `, also ${others}`;
      }
      context += '. ';
    }
  }
  
  // Add last playback emotions (important for understanding user's reaction to AI)
  if (session?.lastPlaybackEmotions && session.lastPlaybackEmotions.length > 0) {
    const playbackEmotions = session.lastPlaybackEmotions.map((e: any) => e.emotion);
    const topPlaybackEmotions = getTopEmotions(playbackEmotions);
    
    if (topPlaybackEmotions.length > 0) {
      const primary = topPlaybackEmotions[0];
      context += `During your last response: ${primary.emotion} (${primary.percentage}%)`;
      
      if (topPlaybackEmotions.length > 1) {
        const others = topPlaybackEmotions.slice(1)
          .map(e => `${e.emotion} (${e.percentage}%)`)
          .join(', ');
        context += `, ${others}`;
      }
      context += '. ';
    }
  }
  
  // Add current emotion as immediate context
  if (session?.emotion) {
    context += `Current: ${session.emotion}. `;
  }
  
  return context;
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
    
    // Send transcription to client with top 3 emotions
    if (session?.ws) {
      // Get top 3 emotions from recording
      let topEmotions: Array<{emotion: string, percentage: number}> = [];
      if (session.recordingEmotions && session.recordingEmotions.length > 0) {
        const emotions = session.recordingEmotions.map(e => e.emotion);
        const emotionCounts = emotions.reduce((acc: any, emotion: string) => {
          acc[emotion] = (acc[emotion] || 0) + 1;
          return acc;
        }, {});
        
        topEmotions = Object.entries(emotionCounts)
          .sort(([,a]: any, [,b]: any) => b - a)
          .slice(0, 3)
          .map(([emotion, count]: any) => ({
            emotion,
            percentage: Math.round((count / emotions.length) * 100)
          }));
      }
      
      session.ws.send(JSON.stringify({
        type: 'transcription',
        text: transcription,
        topEmotions: topEmotions,
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
        content: `You are Pi, a helpful AI assistant. Be EXTREMELY CONCISE - respond in 1-3 sentences max. NO EMOJIS.

CRITICAL: You can SEE the user's face. Trust facial expressions over words. Mixed emotions are normal - respond to the blend you see.

${getEmotionContext(session)}

${(() => {
  // Get emotion blend for nuanced response
  if (session?.recordingEmotions && session.recordingEmotions.length > 0) {
    const emotions = session.recordingEmotions.map(e => e.emotion);
    const emotionCounts = emotions.reduce((acc: any, emotion: string) => {
      acc[emotion] = (acc[emotion] || 0) + 1;
      return acc;
    }, {});
    
    const topEmotions = Object.entries(emotionCounts)
      .sort(([,a]: any, [,b]: any) => b - a)
      .slice(0, 2)
      .map(([emotion, count]: any) => ({
        emotion,
        percentage: Math.round((count / emotions.length) * 100)
      }));
    
    const primary = topEmotions[0]?.emotion || 'neutral';
    const secondary = topEmotions[1]?.emotion;
    
    // Handle emotion blends
    if (secondary && topEmotions[1].percentage > 30) {
      // Significant secondary emotion
      if (primary === 'angry' && secondary === 'sad') {
        return `User is FRUSTRATED and HURT. Acknowledge both feelings briefly. Be gentle but direct.`;
      } else if (primary === 'happy' && secondary === 'surprised') {
        return `User is DELIGHTED! Share their excitement briefly.`;
      } else if (primary === 'sad' && secondary === 'angry') {
        return `User is UPSET. Validate their feelings, offer support.`;
      } else if (primary === 'fearful' && secondary === 'sad') {
        return `User is WORRIED and DOWN. Be reassuring and supportive.`;
      }
    }
    
    // Single dominant emotion
    switch (primary) {
      case 'angry':
        return `User is ANGRY. Acknowledge briefly ("I see you're frustrated") then address their concern.`;
      case 'sad':
        return `User is SAD. Show brief empathy then offer help.`;
      case 'happy':
        return `User is HAPPY! Match their energy briefly.`;
      case 'fearful':
        return `User is ANXIOUS. Be reassuring and solution-focused.`;
      case 'surprised':
        return `User is SURPRISED. Acknowledge and clarify.`;
      case 'disgusted':
        return `User is DISGUSTED. Be understanding, move forward.`;
      default:
        return `Be friendly and helpful.`;
    }
  }
  return 'Be friendly and helpful.';
})()}

REMEMBER: Keep it SHORT. Address emotions naturally without over-analyzing.`
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

    console.log('🎭 Messages:', messages);
    
    // Use the correct Inflection API endpoint from the OpenAPI spec
    const response = await axios.post(
      'https://api.inflection.ai/v1/chat/completions',
      {
        model: 'Pi-3.1',
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 80  // Reduced for more concise responses
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
                 // Determine AI's tone based on user's emotion
                 let aiTone = 'neutral';
                 if (session.recordingEmotions.length > 0) {
                   const recordingEmotions = session.recordingEmotions.map(e => e.emotion);
                   const emotionCounts = recordingEmotions.reduce((acc: any, emotion: string) => {
                     acc[emotion] = (acc[emotion] || 0) + 1;
                     return acc;
                   }, {});
                   const dominantEmotion = Object.entries(emotionCounts)
                     .sort(([,a]: any, [,b]: any) => b - a)[0]?.[0] || 'neutral';
                   
                   // Map user emotion to AI tone
                   const toneMap: Record<string, string> = {
                     'angry': 'calm',
                     'sad': 'empathetic',
                     'happy': 'cheerful',
                     'fearful': 'reassuring',
                     'surprised': 'explanatory',
                     'disgusted': 'understanding',
                     'neutral': 'friendly'
                   };
                   aiTone = toneMap[dominantEmotion] || 'friendly';
                 }
                 
                 session.ws.send(JSON.stringify({
                   type: 'response_chunk',
                   text: content, // Send only the new chunk, not accumulated
                   fullText: fullResponse, // Include full text for context
                   emotion: aiTone, // AI's tone, not user's emotion
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
        emotion: 'friendly', // Default friendly tone for fallback
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
    
    // Determine TTS emotion/style based on user's emotions
    let ttsEmotion = 'neutral';
    let speechRate = 1.0;
    
    if (session) {
      // Get dominant emotion from recording (what user felt while speaking)
      const recordingEmotions = session.recordingEmotions.map(e => e.emotion);
      const emotionCounts = recordingEmotions.reduce((acc: any, emotion: string) => {
        acc[emotion] = (acc[emotion] || 0) + 1;
        return acc;
      }, {});
      
      const dominantEmotion = Object.entries(emotionCounts)
        .sort(([,a]: any, [,b]: any) => b - a)[0]?.[0] || 'neutral';
      
      // Map user emotions to appropriate TTS response style - MORE PRONOUNCED
      switch (dominantEmotion) {
        case 'angry':
          ttsEmotion = 'calm'; // Respond calmly to anger
          speechRate = 0.8; // Much slower - very calming
          console.log('🎭 TTS: ANGRY user → Speaking SLOWLY and CALMLY');
          break;
        case 'sad':
          ttsEmotion = 'empathetic'; // Warm and understanding
          speechRate = 0.85; // Slower, gentler
          console.log('🎭 TTS: SAD user → Speaking GENTLY and WARMLY');
          break;
        case 'happy':
          ttsEmotion = 'cheerful'; // Match their energy
          speechRate = 1.15; // Faster, more energetic
          console.log('🎭 TTS: HAPPY user → Speaking ENTHUSIASTICALLY!');
          break;
        case 'fearful':
          ttsEmotion = 'reassuring'; // Comforting tone
          speechRate = 0.85; // Slower, more reassuring
          console.log('🎭 TTS: FEARFUL user → Speaking REASSURINGLY');
          break;
        case 'surprised':
          ttsEmotion = 'conversational'; // Natural explanation
          speechRate = 0.95; // Slightly slower for clarity
          console.log('🎭 TTS: SURPRISED user → Speaking CLEARLY');
          break;
        case 'disgusted':
          ttsEmotion = 'understanding'; // Non-judgmental
          speechRate = 0.9; // Slower, respectful
          console.log('🎭 TTS: DISGUSTED user → Speaking RESPECTFULLY');
          break;
        default:
          ttsEmotion = 'neutral';
          speechRate = 1.0;
      }
    }
    
    // Generate audio with Resemble with emotion parameters
    // Note: Adjust based on actual Resemble API capabilities
    const response = await Resemble.Resemble.v2.clips.createSync(
      process.env.RESEMBLE_PROJECT_UUID!,
      {
        voice_uuid: process.env.RESEMBLE_VOICE_UUID!,
        body: sentence,
        is_archived: false,
        // Add emotion/style parameters if supported by your Resemble voice
        // emotion: ttsEmotion,
        // speech_rate: speechRate,
        // Note: These parameters depend on your Resemble voice capabilities
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

 