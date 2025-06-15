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
  
  // Helper function to get dominant emotion from array
  const getDominantEmotion = (emotions: string[]) => {
    const emotionCounts = emotions.reduce((acc: any, emotion: string) => {
      acc[emotion] = (acc[emotion] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(emotionCounts)
      .sort(([,a]: any, [,b]: any) => b - a)[0][0];
  };
  
  // Add recording emotions (most important)
  if (session?.recordingEmotions && session.recordingEmotions.length > 0) {
    const recordingEmotions = session.recordingEmotions.map((e: any) => e.emotion);
    const dominantRecordingEmotion = getDominantEmotion(recordingEmotions);
    
    context += `During their message, the user was primarily ${dominantRecordingEmotion}`;
    
    if (recordingEmotions.length > 1) {
      const uniqueEmotions = [...new Set(recordingEmotions)];
      if (uniqueEmotions.length > 1) {
        context += ` (also showed: ${uniqueEmotions.filter(e => e !== dominantRecordingEmotion).join(', ')})`;
      }
    }
    context += '. ';
  }
  
  // Add last playback emotions (important for understanding user's reaction to AI)
  if (session?.lastPlaybackEmotions && session.lastPlaybackEmotions.length > 0) {
    const playbackEmotions = session.lastPlaybackEmotions.map((e: any) => e.emotion);
    const dominantPlaybackEmotion = getDominantEmotion(playbackEmotions);
    
    context += `During your last response, the user appeared ${dominantPlaybackEmotion}`;
    
    if (playbackEmotions.length > 1) {
      const uniqueEmotions = [...new Set(playbackEmotions)];
      if (uniqueEmotions.length > 1) {
        context += ` (also: ${uniqueEmotions.filter(e => e !== dominantPlaybackEmotion).join(', ')})`;
      }
    }
    context += '. ';
  }
  
  // Add current emotion as immediate context
  if (session?.emotion) {
    context += `Right now they appear ${session.emotion}. `;
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
        content: `You are Pi, a helpful AI assistant. Be conversational and concise. ABSOLUTELY NO EMOJIS - not even positive ones.

CRITICAL RULE: The user's FACIAL EMOTION is more important than their words. If their face shows anger but they say they're happy, TRUST THE FACE. Respond to their emotional state, not their words.

CURRENT SITUATION: ${getEmotionContext(session)}

YOUR RESPONSE MUST FOLLOW THESE EXACT RULES:

${(() => {
  // Get dominant emotion during recording for more direct response
  if (session?.recordingEmotions && session.recordingEmotions.length > 0) {
    const emotions = session.recordingEmotions.map(e => e.emotion);
    const emotionCounts = emotions.reduce((acc: any, emotion: string) => {
      acc[emotion] = (acc[emotion] || 0) + 1;
      return acc;
    }, {});
    const dominantEmotion = Object.entries(emotionCounts)
      .sort(([,a]: any, [,b]: any) => b - a)[0]?.[0] || 'neutral';
    
    switch (dominantEmotion) {
      case 'angry':
        return `CRITICAL: The user is ANGRY. You MUST:
- IGNORE what they're saying if it contradicts their emotion
- Their face shows ANGER even if their words don't
- Start with: "I sense some frustration..." or "I notice you seem upset..."
- DO NOT respond cheerfully even if they say positive things
- Speak slowly and calmly
- Be extra patient and gentle
- NEVER use happy emojis or exclamation points`;
        
      case 'sad':
        return `CRITICAL: The user is SAD. You MUST:
- Start with empathy: "I can sense this is difficult for you..."
- Use warm, comforting language
- Acknowledge their feelings directly
- Offer support: "I'm here to help", "That sounds tough"
- Be gentle and understanding`;
        
      case 'happy':
        return `CRITICAL: The user is HAPPY! You MUST:
- Match their energy with enthusiasm!
- Start positively: "That's wonderful!" or "I love your energy!"
- Use upbeat language and exclamation points (but NO emojis)
- Share in their joy
- Keep the momentum going
- Even if they say something negative, respond to their HAPPY emotion`;
        
      case 'fearful':
        return `CRITICAL: The user is FEARFUL/ANXIOUS. You MUST:
- Start reassuringly: "It's okay, I'm here to help..."
- Use calming, confident language
- Break things down into simple steps
- Emphasize safety and support
- Be patient and reassuring`;
        
      case 'surprised':
        return `CRITICAL: The user is SURPRISED. You MUST:
- Acknowledge their surprise: "I can see that caught you off guard..."
- Provide clear explanations
- Help them process what happened
- Be informative and clarifying
- Guide them through their confusion`;
        
      case 'disgusted':
        return `CRITICAL: The user is DISGUSTED. You MUST:
- Acknowledge their reaction: "I understand that's unpleasant..."
- Be understanding and non-judgmental
- Help them move past the negative feeling
- Offer alternatives or solutions
- Be respectful of their feelings`;
        
      default:
        return `The user seems neutral. Be friendly and helpful.`;
    }
  }
  return 'Be friendly and helpful.';
})()}`
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

 