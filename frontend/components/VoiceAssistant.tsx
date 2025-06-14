'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  type: 'transcription' | 'response' | 'emotion';
  text?: string;
  emotion?: string;
  timestamp: string;
}

export function VoiceAssistant() {
  // State management
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [sessionId, setSessionId] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  
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
  
  // Conversation state
  const currentResponseDivRef = useRef<HTMLDivElement | null>(null);

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

  // Start video immediately when component mounts
  useEffect(() => {
    startVideo();
    return () => {
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 5 }
        },
        audio: true 
      });
      
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsStreaming(true);
          sendVideoFrames();
        };
      }
    } catch (err) {
      console.error('Error accessing media devices:', err);
    }
  };

  const sendVideoFrames = () => {
    if (!isStreaming || !videoRef.current || !canvasRef.current) return;

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
      
      // Send to emotion detection (we'll implement a simple version)
      if (frame && frame.length > 22) {
        processEmotion(frame);
      }
    } catch (err) {
      console.error('Error capturing video frame:', err);
    }

    // Schedule next frame
    setTimeout(sendVideoFrames, 200); // 5 FPS
  };

  // Simple emotion processing (placeholder - you can integrate with your emotion server)
  const processEmotion = async (frameData: string) => {
    try {
      // Extract base64 data
      const base64Data = frameData.split(',')[1];
      
      // For now, we'll simulate emotion detection
      // You can replace this with actual API calls to your emotion server
      const emotions = ['happy', 'sad', 'angry', 'neutral', 'surprised'];
      const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];
      
      // Update emotion with some randomness to simulate real detection
      if (Math.random() > 0.7) { // Only update 30% of the time to avoid too frequent changes
        setCurrentEmotion(randomEmotion);
        
        // Forward emotion to Node.js backend if connected
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ 
            type: 'emotion_update', 
            emotion: randomEmotion 
          }));
        }
      }
    } catch (error) {
      console.error('Error processing emotion:', error);
    }
  };

  // Audio playback - optimized for lower latency
  const playNextAudioChunk = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    
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
      // Clear any pending audio queue when starting new recording
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      
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
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
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

  // Handle button press/release
  const handleMouseDown = () => {
    if (isConnected && isVoiceActive) {
      startRecording();
    }
  };

  const handleMouseUp = () => {
    if (isRecording) {
      stopRecording();
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
      happy: '#4CAF50',
      sad: '#2196F3',
      angry: '#F44336',
      neutral: '#9E9E9E',
      fearful: '#9C27B0',
      disgusted: '#FF9800',
      surprised: '#FFEB3B'
    };
    return colors[emotion] || '#9E9E9E';
  };

  // Main activation handler - only toggles voice, video runs always
  const handleActivation = () => {
    setIsVoiceActive(!isVoiceActive);
    
    if (isRecording) {
      stopRecording();
    }
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
                {message.emotion && ` (${message.emotion})`}
              </div>
              <div className="message-text">{message.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Push-to-Talk Button */}
      <div className="center-control">
        <button
          className={`voice-button ${isVoiceActive ? 'active' : ''} ${isRecording ? 'recording' : ''}`}
          onClick={handleActivation}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          disabled={!isConnected && isVoiceActive}
        >
          <div className="pulse-ring" />
          <div className="button-text">
            {!isVoiceActive ? 'Start' : isRecording ? 'Recording...' : 'Hold to Talk'}
          </div>
        </button>
      </div>

      {/* Video Container */}
      <div className="video-container">
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
           ? (isVoiceActive ? 'Hold the button or press SPACEBAR to record' : 'Click Start to enable voice input')
           : 'Connecting to server...'}
       </p>

             <style jsx global>{`
         * {
           margin: 0;
           padding: 0;
           box-sizing: border-box;
         }
         
         html, body {
           margin: 0;
           padding: 0;
           width: 100vw;
           height: 100vh;
           background: #1a1a1a;
           overflow: hidden;
         }
         
         #__next {
           width: 100vw;
           height: 100vh;
           background: #1a1a1a;
         }
         
         .container {
           width: 100vw;
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
           background: rgba(0, 0, 0, 0.85);
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

        .voice-button.active {
          background: #4CAF50;
          box-shadow: 0 4px 20px rgba(76, 175, 80, 0.6);
        }

        .voice-button.recording {
          background: #F44336;
          box-shadow: 0 4px 20px rgba(244, 67, 54, 0.6);
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