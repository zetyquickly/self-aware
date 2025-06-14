# Voice Assistant Backend API

A Node.js/Express backend for a real-time voice assistant with streaming AI responses and text-to-speech capabilities.

## Architecture

The backend implements a complete voice processing pipeline:
1. **Audio Upload** → Deepgram STT (Speech-to-Text)
2. **Text Processing** → Inflection AI (Streaming LLM Response)
3. **Audio Generation** → Resemble AI TTS (Text-to-Speech)
4. **Real-time Communication** → WebSocket for streaming responses and audio

## Environment Variables

Create a `.env` file with the following variables:

```env
# API Keys
DEEPGRAM_API_KEY=your_deepgram_api_key
INFLECTION_API_KEY=your_inflection_api_key
RESEMBLE_API_KEY=your_resemble_api_key
RESEMBLE_PROJECT_UUID=your_resemble_project_uuid
RESEMBLE_VOICE_UUID=your_resemble_voice_uuid

# Server Configuration
PORT=3000
CORS_ORIGIN=http://localhost:3001

# Deepgram Configuration (Optional)
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=en-US
```

## REST API Endpoints

### Audio Processing

#### `POST /api/audio/process`
Processes uploaded audio through the complete pipeline.

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `audio`: Audio file (WebM, MP3, WAV, etc.)
  - `sessionId`: Session identifier (optional, auto-generated if not provided)

**Response:**
```json
{
  "success": true,
  "sessionId": "session_1705312245123",
  "transcription": "Hello, how are you today?"
}
```

**Error Response:**
```json
{
  "error": "No audio file provided"
}
```

#### `GET /api/audio/voices`
Lists available Resemble AI voices for debugging.

**Response:**
```json
{
  "message": "Check console for available voices"
}
```

### Health Check

#### `GET /health`
Server health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

## WebSocket API

Connect to: `ws://localhost:3000`

### Client → Server Messages

#### Session Initialization
```json
{
  "type": "init",
  "sessionId": "session_1705312245123"
}
```

#### Emotion Update
```json
{
  "type": "emotion_update",
  "emotion": "happy"
}
```

### Server → Client Messages

#### Session Created
```json
{
  "type": "session_created",
  "sessionId": "session_1705312245123"
}
```

#### Transcription Result
```json
{
  "type": "transcription",
  "text": "Hello, how are you today?",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

#### Streaming Response Chunk
```json
{
  "type": "response_chunk",
  "text": "Hi there! ",
  "fullText": "Hi there! I'm doing well, thank you for asking.",
  "emotion": "neutral",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

#### Audio Chunk
```json
{
  "type": "audio_chunk",
  "audio": "base64_encoded_audio_data",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

#### Audio Complete
```json
{
  "type": "audio_complete",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

## Processing Pipeline

### 1. Audio Upload & STT
- Client uploads audio via `/api/audio/process`
- Audio is transcribed using Deepgram STT (non-streaming)
- Transcription sent to client via WebSocket

### 2. LLM Processing
- Transcription sent to Inflection AI Pi-3.1 model
- Response is streamed in real-time via Server-Sent Events
- Each chunk is immediately forwarded to client via WebSocket
- Sentences are detected and queued for TTS generation

### 3. TTS Generation
- Complete sentences are queued for TTS processing
- Resemble AI generates audio for each sentence
- Audio chunks are sent to client as base64-encoded data
- Client plays audio chunks sequentially

## Queue Management

The backend implements a TTS queue system to prevent audio overlap:

- **Per-session queues**: Each WebSocket session has its own TTS queue
- **Sequential processing**: Sentences are processed one at a time
- **Automatic cleanup**: Queues are cleared when sessions end or new recordings start
- **Deduplication**: Prevents the same sentence from being processed twice

## Logging

The backend logs all interactions for debugging:

### Response Logging (`logs/inflection-responses.log`)
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "sessionId": "session_1705312245123",
  "prompt": "Hello, how are you?",
  "response": "Hi there! I'm doing well, thank you for asking.",
  "isStreaming": true,
  "responseLength": 45
}
```

### Streaming Logging (`logs/inflection-streaming.log`)
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "sessionId": "session_1705312245123",
  "chunk": "Hi there! ",
  "fullResponseSoFar": "Hi there! I'm doing well",
  "chunkLength": 10,
  "totalLength": 25
}
```

## Error Handling

### Common Errors

1. **Missing API Keys**: Ensure all required environment variables are set
2. **Invalid Voice UUID**: Use `/api/audio/voices` to list available voices
3. **Audio Format Issues**: Supported formats include WebM, MP3, WAV
4. **WebSocket Connection**: Check CORS settings and port configuration

### Error Responses

All endpoints return appropriate HTTP status codes:
- `400`: Bad Request (missing audio file, invalid parameters)
- `500`: Internal Server Error (API failures, processing errors)

## Development

### Starting the Server
```bash
npm run dev
```

### Building for Production
```bash
npm run build
npm start
```

### Project Structure
```
backend2/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── websocket.ts          # WebSocket connection handling
│   ├── types.ts              # TypeScript type definitions
│   ├── routes/
│   │   └── audio.ts          # Audio processing routes
│   └── services/
│       └── audioPipeline.ts  # Core processing pipeline
├── logs/                     # Generated log files
├── .env                      # Environment variables
└── README.md                 # This file
```

## Dependencies

### Core Dependencies
- `express`: Web server framework
- `ws`: WebSocket implementation
- `@deepgram/sdk`: Speech-to-text processing
- `axios`: HTTP client for API calls
- `@resemble/node`: Text-to-speech generation
- `multer`: File upload handling

### Development Dependencies
- `typescript`: TypeScript compiler
- `ts-node`: TypeScript execution
- `nodemon`: Development server with hot reload

## API Integration Examples

### cURL Examples

#### Process Audio
```bash
curl -X POST http://localhost:3000/api/audio/process \
  -F "audio=@recording.webm" \
  -F "sessionId=test_session"
```

#### Health Check
```bash
curl http://localhost:3000/health
```

### JavaScript WebSocket Client
```javascript
const ws = new WebSocket('ws://localhost:3000');

// Initialize session
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'init',
    sessionId: 'my_session_id'
  }));
};

// Handle messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'transcription':
      console.log('User said:', data.text);
      break;
    case 'response_chunk':
      console.log('AI chunk:', data.text);
      break;
    case 'audio_chunk':
      // Play audio chunk
      playAudioChunk(data.audio);
      break;
  }
};
```

## Performance Considerations

- **Streaming**: Responses are streamed in real-time for low latency
- **Queue Management**: TTS processing is queued to prevent overlap
- **Memory Management**: Audio buffers are processed and released promptly
- **Connection Pooling**: WebSocket connections are reused for efficiency

## Security Notes

- API keys are stored in environment variables
- CORS is configured for specific origins
- File uploads are limited to audio formats
- WebSocket connections are validated per session 