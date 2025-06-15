'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  type: 'transcription' | 'response' | 'emotion';
  text?: string;
  emotion?: string;
  userEmotion?: string; // User's emotion during recording
  topEmotions?: Array<{emotion: string, percentage: number}>; // Top 3 emotions
  timestamp: string;
}

export function VoiceAssistant() {
  // State management
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [recordingEmotion, setRecordingEmotion] = useState('neutral');
  const [sessionId, setSessionId] = useState<string>('');
  
  // Refs for media handling
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  
  // Video refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const emotionSocketRef = useRef<any>(null);
  const isStreamingRef = useRef<boolean>(false);
  
  // Conversation state
  const currentResponseDivRef = useRef<HTMLDivElement | null>(null);
  
  // Rate limiting for emotion detection
  const lastEmotionRequestRef = useRef<number>(0);
  const EMOTION_REQUEST_INTERVAL = 1000; // 1 second between requests
  const frameCountRef = useRef<number>(0);

  // Initialize WebSocket connection to Node.js backend
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      const newSessionId = `session_${Date.now()}`;
      setSessionId(newSessionId);
      ws.send(JSON.stringify({ type: 'init', sessionId: newSessionId }));
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'session_created':
          console.log('Session created:', data.sessionId);
          break;
          
        case 'transcription':
          setMessages(prev => [...prev, {
            type: 'transcription',
            text: data.text,
            userEmotion: recordingEmotion, // Include the emotion during recording
            topEmotions: data.topEmotions, // Include top 3 emotions
            timestamp: data.timestamp
          }]);
          break;
          
        case 'response_chunk':
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.type === 'response' && 
                new Date(data.timestamp).getTime() - new Date(lastMessage.timestamp).getTime() < 5000) {
              // Update existing message with full text
              return [...prev.slice(0, -1), {
                ...lastMessage,
                text: data.fullText || data.text,
                timestamp: data.timestamp
              }];
            } else {
              // Add new message
              return [...prev, {
                type: 'response',
                text: data.fullText || data.text,
                emotion: data.emotion,
                timestamp: data.timestamp
              }];
            }
          });
          if (data.emotion) {
            setCurrentEmotion(data.emotion);
          }
          break;
          
        case 'audio_chunk':
          // Decode and queue audio - play immediately for lower latency
          const audioData = base64ToArrayBuffer(data.audio);
          audioQueueRef.current.push(audioData);
          if (!isPlayingRef.current) {
            playNextAudioChunk();
          }
          break;
          
        case 'emotion_update':
          console.log('🎭 Emotion updated:', data.emotion);
          setCurrentEmotion(data.emotion);
          // If recording, also update recording emotion
          if (isRecording) {
            setRecordingEmotion(data.emotion);
          }
          break;
          
        case 'pong':
          console.log('🏓 Received pong from backend');
          break;
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, []);

  // Initialize WebSocket when component mounts
  useEffect(() => {
    console.log('🚀 Component mounted...');
    
    // Debug: Check if WebSocket is connected and test it
    setTimeout(() => {
      console.log('🔍 WebSocket status check:');
      console.log('- wsRef.current:', !!wsRef.current);
      console.log('- WebSocket state:', wsRef.current?.readyState);
      console.log('- isConnected:', isConnected);
      console.log('- isStreaming:', isStreamingRef.current);
      
      // Test WebSocket with a ping
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('🏓 Sending test ping...');
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 3000);
    
    return () => {
      console.log('🧹 Component unmounting, cleaning up...');
      if (emotionSocketRef.current) {
        emotionSocketRef.current.close();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Spacebar support for voice input
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat && isConnected && isVoiceActive && !isRecording) {
        event.preventDefault();
        startRecording();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && isRecording) {
        event.preventDefault();
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isConnected, isVoiceActive, isRecording]);

  // Video streaming functions
  const startVideo = async () => {
    console.log('🎥 Starting video...');
    try {
      console.log('Requesting media access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 5 }
        },
        audio: true 
      });
      
      console.log('✅ Media access granted, stream:', stream);
      mediaStreamRef.current = stream;
      
      if (videoRef.current) {
        console.log('Setting video srcObject...');
        videoRef.current.srcObject = stream;
        
        videoRef.current.onloadedmetadata = () => {
          console.log('✅ Video metadata loaded, starting playback...');
          videoRef.current?.play().then(() => {
            console.log('✅ Video playing, starting frame capture...');
            isStreamingRef.current = true;
            sendVideoFrames();
          }).catch(err => {
            console.error('❌ Video play failed:', err);
          });
        };
        
        videoRef.current.onerror = (err) => {
          console.error('❌ Video error:', err);
        };
      } else {
        console.error('❌ videoRef.current is null');
      }
    } catch (err) {
      console.error('❌ Error accessing media devices:', err);
    }
  };

  const sendVideoFrames = () => {
    if (!isStreamingRef.current || !videoRef.current || !canvasRef.current) {
      setTimeout(sendVideoFrames, 100);
      return;
    }

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        setTimeout(sendVideoFrames, 100);
        return;
      }

      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw current frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Get frame data with reduced quality
      const frame = canvas.toDataURL('image/jpeg', 0.8);
      
      // Rate limit emotion detection requests
      const currentTime = Date.now();
      
      if (frame && frame.length > 22 && 
          currentTime - lastEmotionRequestRef.current >= EMOTION_REQUEST_INTERVAL) {
        lastEmotionRequestRef.current = currentTime;
        frameCountRef.current += 1;
        // Reduced logging - only log every 10th frame
        if (frameCountRef.current % 10 === 0) {
          console.log(`📹 Sent ${frameCountRef.current} video frames`);
        }
        
        // Send video frame via WebSocket (like the Python Flask version)
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'video_frame',
            frame: frame
          }));
        } else {
          console.warn('⚠️ WebSocket not connected, cannot send video frame');
        }
      }
    } catch (err) {
      console.error('❌ Error capturing video frame:', err);
    }

    // Schedule next frame
    setTimeout(sendVideoFrames, 100); // 10 FPS
  };

  // Real emotion processing using your emotion detection server
  const processEmotion = async (frameData: string) => {
    try {
      // Extract base64 data
      const base64Data = frameData.split(',')[1];
      
      if (!base64Data) {
        console.warn('Invalid frame data for emotion processing');
        return;
      }
      
      console.log('Attempting emotion detection via Node.js proxy...');
      console.log('Base64 data length:', base64Data.length);
      
      // Use Node.js backend as proxy to avoid CORS issues
      const response = await fetch('http://localhost:3001/api/audio/emotion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_base64: base64Data
        }),
        signal: AbortSignal.timeout(5000)
      });
      
      console.log('Emotion server response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Emotion server response data:', data);
        
        if (data.success && data.detections && data.detections.length > 0) {
          // Get the first detected emotion
          const detection = data.detections[0];
          let emotionText = detection.emotion;
          
          console.log('Detected emotion:', emotionText);
          
          // Extract just the emotion name (remove confidence if present)
          const emotionName = emotionText.split('(')[0].trim().toLowerCase();
          
          // Map emotion names to match your color scheme
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
          console.log('Mapped emotion:', mappedEmotion);
          
          // Update emotion state
          setCurrentEmotion(mappedEmotion);
          
          // Forward emotion to Node.js backend if connected
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ 
              type: 'emotion_update', 
              emotion: mappedEmotion 
            }));
          }
        } else {
          console.warn('No detections in emotion server response');
        }
      } else {
        console.warn('Emotion server returned non-OK status:', response.status);
        const errorText = await response.text();
        console.warn('Error response:', errorText);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn('Emotion detection request timed out');
      } else if (error instanceof Error && error.name === 'TypeError') {
        console.warn('Could not connect to emotion server - is it running on localhost:5139?');
        console.warn('CORS might be blocking the request. Check browser console for CORS errors.');
      } else {
        console.error('Error processing emotion:', error);
      }
      // Don't update emotion on error - keep the last known emotion
    }
  };

  // Audio playback - optimized for lower latency
  const playNextAudioChunk = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      // Notify backend that TTS playback stopped
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'tts_stop' }));
      }
      return;
    }

    // If this is the first chunk, notify backend that TTS started
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'tts_start' }));
      }
    }
    
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      // Resume context if suspended (helps with latency)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
    }

    const audioData = audioQueueRef.current.shift()!;
    
    try {
      const audioBuffer = await audioContextRef.current.decodeAudioData(audioData);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        // Reduce delay between chunks
        setTimeout(playNextAudioChunk, 50);
      };
      
      source.start(0); // Start immediately
    } catch (error) {
      console.error('Error playing audio:', error);
      // Continue with next chunk even if this one fails
      setTimeout(playNextAudioChunk, 50);
    }
  };

  // Start recording
  const startRecording = async () => {
    try {
      // Stop any ongoing TTS playback
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      
      // Close and reset audio context to ensure clean state
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendAudioToBackend(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      // Capture current emotion as recording emotion
      setRecordingEmotion(currentEmotion);
      
      // Notify backend that recording started
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'recording_start' }));
      }
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Notify backend that recording stopped
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'recording_stop' }));
      }
    }
  };

  // Send audio to backend
  const sendAudioToBackend = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('sessionId', sessionId);

    try {
      const response = await fetch('http://localhost:3001/api/audio/process', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to process audio');
      }
    } catch (error) {
      console.error('Error sending audio:', error);
    }
  };

  // Handle voice mode toggle
  const handleVoiceModeToggle = () => {
    if (!isVoiceActive) {
      handleActivation(); // Start voice mode
    } else {
      // Stop everything
      if (isRecording) {
        stopRecording();
      }
      handleActivation(); // Stop voice mode
    }
  };

  // Helper function
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const getEmotionColor = (emotion: string) => {
    const colors: Record<string, string> = {
      // User emotions
      happy: '#4CAF50',
      sad: '#2196F3',
      angry: '#F44336',
      neutral: '#9E9E9E',
      fearful: '#9C27B0',
      disgusted: '#FF9800',
      surprised: '#FFEB3B',
      // Additional mappings for your emotion server
      anger: '#F44336',
      contempt: '#795548',
      disgust: '#FF9800',
      fear: '#9C27B0',
      surprise: '#FFEB3B',
      // AI tones
      calm: '#64B5F6',        // Light blue - soothing
      empathetic: '#81C784',  // Soft green - warm
      cheerful: '#FFD54F',    // Bright yellow - happy
      reassuring: '#BA68C8',  // Soft purple - comforting
      explanatory: '#4FC3F7', // Light cyan - clear
      understanding: '#A1887F', // Warm brown - accepting
      friendly: '#66BB6A',    // Medium green - approachable
      assertive: '#FF7043'    // Orange-red - firm but controlled
    };
    return colors[emotion] || '#9E9E9E';
  };

  // Main activation handler - toggles both voice and video
  const handleActivation = () => {
    const newActiveState = !isVoiceActive;
    setIsVoiceActive(newActiveState);
    
    if (newActiveState) {
      // Starting everything
      startVideo();
      isStreamingRef.current = true;
    } else {
      // Stopping everything
      if (isRecording) {
        stopRecording();
      }
      
      // Stop video stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Clear video display
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      isStreamingRef.current = false;
      
      // Clear audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // Clear audio queue
      audioQueueRef.current = [];
      isPlayingRef.current = false;
    }
    // Don't toggle off - once activated, it stays on
  };

  return (
    <div className="container">

      {/* Connection Status */}
      <div className="connection-status">
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Emotion Display */}
      <div className="emotion-display">
        <div 
          className={`emotion-label ${currentEmotion}`}
          style={{ backgroundColor: getEmotionColor(currentEmotion) }}
        >
          {currentEmotion.toUpperCase()}
          <span className="emotion-indicator">●</span>
        </div>
      </div>

      {/* Conversation Stream */}
      <div className="conversation-stream">
        <div className="conversation-content">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`message-div ${message.type}`}
            >
              <div className="message-label">
                {message.type === 'transcription' ? 'HUMAN:' : 'AI:'}
                {message.type === 'transcription' && message.topEmotions && message.topEmotions.length > 0 && (
                  <div className="emotion-badges">
                    {message.topEmotions.map((emotionData, idx) => (
                      <span 
                        key={idx}
                        className="emotion-badge"
                        style={{ 
                          backgroundColor: getEmotionColor(emotionData.emotion),
                          opacity: idx === 0 ? 1 : 0.7 - (idx * 0.15)
                        }}
                      >
                        {emotionData.emotion} {emotionData.percentage}%
                      </span>
                    ))}
                  </div>
                )}
                {message.type === 'response' && message.emotion && (
                  <div className="emotion-badges">
                    <span 
                      className="emotion-badge"
                      style={{ 
                        backgroundColor: getEmotionColor(message.emotion)
                      }}
                    >
                      {message.emotion}
                    </span>
                  </div>
                )}
              </div>
              <div className="message-text">{message.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Push-to-Talk Button */}
      <div className="center-control">
        <button
          className={`voice-button ${isVoiceActive ? 'stop' : ''} ${isRecording ? 'recording' : ''}`}
          onClick={handleVoiceModeToggle}
          disabled={!isConnected}
        >
          <div className="pulse-ring" />
          <div className="button-text">
            {!isVoiceActive ? 'Start Voice Mode' : isRecording ? 'Recording...' : 'Stop Voice Mode'}
          </div>
        </button>
      </div>

      {/* Video Container */}
      <div className={`video-container ${isVoiceActive ? 'active' : ''}`}>
        <video 
          ref={videoRef}
          autoPlay 
          playsInline 
          muted
          className="video-element"
        />
        <canvas 
          ref={canvasRef}
          style={{ display: 'none' }}
        />
      </div>

             {/* Instructions */}
       <p className="instructions">
         {isConnected 
           ? (isVoiceActive ? 'Hold SPACEBAR to record' : 'Click Start to enable voice input')
           : 'Connecting to server...'}
       </p>

             <style jsx global>{`
         * {
           margin: 0;
           padding: 0;
           box-sizing: border-box;
         }
         
         /* Remove any default Next.js or parent styling */
         body > div:first-child,
         #__next > div {
           background: transparent !important;
         }
         
         html, body {
           margin: 0;
           padding: 0;
           width: 100vw;
           height: 100vh;
           background: #1a1a1a;
           overflow: hidden;
         }
         
         body {
           background: #1a1a1a !important;
         }
         
         #__next {
           width: 100vw;
           height: 100vh;
           background: #1a1a1a !important;
         }
         
         .container {
           width: 100%;
           min-width: 100vw;
           height: 100vh;
           margin: 0;
           padding: 0;
           position: fixed;
           top: 0;
           left: 0;
           right: 0;
           bottom: 0;
           background: #1a1a1a;
           color: white;
           overflow: hidden;
           font-family: Arial, sans-serif;
           display: flex;
           flex-direction: column;
         }

                 .header-text {
           position: fixed;
           top: 30px;
           left: 50%;
           transform: translateX(-50%);
           font-size: 32px;
           font-weight: bold;
           color: white;
           text-align: center;
           max-width: 90%;
           padding: 25px 40px;
           background: linear-gradient(135deg, rgba(76, 175, 80, 0.3), rgba(156, 39, 176, 0.3));
           border-radius: 25px;
           z-index: 1000;
           box-shadow: 
             0 4px 25px rgba(76, 175, 80, 0.3),
             0 8px 40px rgba(0, 0, 0, 0.4),
             inset 0 0 0 1px rgba(255, 255, 255, 0.1);
           backdrop-filter: blur(10px);
           animation: fadeIn 1.2s ease-out, glowPulse 3s infinite;
           text-shadow: 
             0 0 20px rgba(76, 175, 80, 0.5),
             0 0 40px rgba(76, 175, 80, 0.3);
           letter-spacing: 0.5px;
           line-height: 1.4;
         }

        .connection-status {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 1000;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 500;
        }

        .status-indicator.connected {
          color: #4CAF50;
        }

        .status-indicator.disconnected {
          color: #F44336;
        }

        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        .status-dot.connected {
          background: #4CAF50;
        }

        .status-dot.disconnected {
          background: #F44336;
        }

                 .emotion-display {
           position: fixed;
           bottom: 80px;
           right: 20px;
           z-index: 1000;
         }

        .emotion-label {
          padding: 15px 35px;
          border-radius: 30px;
          font-weight: bold;
          font-size: 18px;
          text-align: center;
          border: 3px solid rgba(255, 255, 255, 0.2);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          text-transform: uppercase;
          letter-spacing: 3px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .emotion-indicator {
          font-size: 16px;
          animation: blink 1.5s infinite;
        }

                 .conversation-stream {
           position: fixed;
           top: 45%;
           left: 50%;
           transform: translate(-50%, -50%);
           width: 85%;
           max-width: 1400px;
           height: 50vh;
           background: rgba(0, 0, 0, 0.95);
           border-radius: 30px;
           padding: 40px;
           overflow-y: auto;
           box-shadow: 0 10px 50px rgba(0,0,0,0.5);
           border: 1px solid rgba(255,255,255,0.1);
           backdrop-filter: blur(10px);
           z-index: 100;
         }

        .conversation-content {
          display: flex;
          flex-direction: column;
          gap: 20px;
          font-size: 24px;
          line-height: 1.4;
        }

        .message-div {
          padding: 25px 35px;
          font-size: 24px;
          line-height: 1.5;
          box-shadow: 0 8px 25px rgba(0,0,0,0.2);
          border-radius: 20px;
          margin: 10px 0;
          opacity: 0;
          animation: messageAppear 0.5s forwards;
          background: linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0));
          backdrop-filter: blur(5px);
          border: 1px solid rgba(255,255,255,0.1);
        }

        .message-div.transcription {
          background: linear-gradient(145deg, rgba(51,51,51,0.9), rgba(41,41,41,0.9));
          align-self: flex-start;
          max-width: 80%;
        }

                 .message-div.response {
           background: linear-gradient(145deg, rgba(76,175,80,0.9), rgba(56,142,60,0.9));
           align-self: flex-end;
           max-width: 80%;
           margin-left: auto;
         }

        .message-label {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 8px;
          opacity: 0.8;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .emotion-badges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .emotion-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          white-space: nowrap;
        }

        .message-text {
          font-size: 18px;
          line-height: 1.4;
        }

                 .center-control {
           position: fixed;
           bottom: 120px;
           left: 50%;
           transform: translateX(-50%);
           z-index: 200;
         }

        .voice-button {
          width: 150px;
          height: 150px;
          border-radius: 50%;
          background: #2196F3;
          border: none;
          color: white;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 20px rgba(33, 150, 243, 0.4);
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-button:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 25px rgba(33, 150, 243, 0.6);
        }

        .voice-button.stop {
          background: #F44336;
          box-shadow: 0 4px 20px rgba(244, 67, 54, 0.6);
        }

        .voice-button.recording {
          background: #4CAF50;
          box-shadow: 0 4px 20px rgba(76, 175, 80, 0.6);
          transform: scale(1.05);
        }

        .voice-button.recording .pulse-ring {
          animation: pulse 2s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
        }

        .pulse-ring {
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.5);
          opacity: 0;
        }

        .button-text {
          z-index: 1;
          text-align: center;
        }

  .video-container {
           position: fixed;
           bottom: 20px;
           right: 20px;
           width: 320px;
           border-radius: 12px;
           overflow: hidden;
           z-index: 100;
           padding-bottom: 60px;
           opacity: 0;
           transition: opacity 0.3s ease;
         }

        .video-container.active {
           opacity: 1;
         }

        .video-element {
          width: 100%;
          border-radius: 12px;
          border: 2px solid #333;
        }

        .instructions {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255, 255, 255, 0.7);
          text-align: center;
          font-size: 16px;
          z-index: 100;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -30px);
            filter: blur(10px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
            filter: blur(0);
          }
        }

                 @keyframes glowPulse {
           0%, 100% {
             box-shadow: 
               0 4px 25px rgba(76, 175, 80, 0.3),
               0 8px 40px rgba(0, 0, 0, 0.4),
               inset 0 0 0 1px rgba(255, 255, 255, 0.1);
           }
           50% {
             box-shadow: 
               0 4px 30px rgba(76, 175, 80, 0.4),
               0 8px 50px rgba(0, 0, 0, 0.5),
               inset 0 0 0 1px rgba(255, 255, 255, 0.2);
           }
         }

        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        @keyframes messageAppear {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .conversation-stream::-webkit-scrollbar {
          width: 12px;
        }

        .conversation-stream::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.1);
          border-radius: 6px;
        }

        .conversation-stream::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 6px;
        }

        .conversation-stream::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.3);
        }
      `}</style>
    </div>
  );
} 
