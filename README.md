# Self-Aware AI



https://github.com/user-attachments/assets/1eb19437-42ec-4c5d-b1ea-637c86e04867


An AI assistant that can read emotions from video and respond with voice using advanced speech processing.

## Features

- **Real-time Emotion Detection**: Uses computer vision to detect emotions from video feed
- **Voice Processing**: Complete audio pipeline with speech-to-text, AI response generation, and text-to-speech
- **Str


eaming Responses**: Real-time AI responses that adapt to detected emotions
- **Push-to-Talk Interface**: Hold button to record, release to process
- **Visual Feedback**: Live emotion display and conversation stream

## Architecture

The application consists of two integrated servers:

1. **Flask Frontend** (Port 5001): Handles video processing, emotion detection, and UI
2. **Node.js Backend** (Port 3001): Processes audio with STT, LLM, and TTS services

### Audio Processing Pipeline

1. **Audio Recording** → WebM audio capture
2. **Speech-to-Text** → Deepgram STT API
3. **AI Response** → Inflection AI streaming responses
4. **Text-to-Speech** → Resemble AI voice synthesis
5. **Audio Playback** → Real-time audio streaming

## Setup

### Prerequisites

- Python 3.8+
- Node.js 16+
- npm or yarn

### API Keys Required

You'll need API keys for:
- **Deepgram**: Speech-to-text processing
- **Inflection AI**: LLM responses  
- **Resemble AI**: Text-to-speech synthesis

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd self-aware-real
   ```

2. **Install Python dependencies**
   ```bash
   pip install flask flask-socketio requests opencv-python numpy
   ```

3. **Install Node.js dependencies**
   ```bash
   cd backend
   npm install
   cd ..
   ```

4. **Configure API Keys**
   ```bash
   # Copy the example environment file
   cp backend/env.example backend/.env
   
   # Edit backend/.env with your API keys:
   # DEEPGRAM_API_KEY=your_key_here
   # INFLECTION_API_KEY=your_key_here  
   # RESEMBLE_API_KEY=your_key_here
   # RESEMBLE_PROJECT_UUID=your_uuid_here
   # RESEMBLE_VOICE_UUID=your_voice_uuid_here
   ```

## Running the Application

### Quick Start
```bash
./start.sh
```

This will start both servers automatically:
- Frontend: http://localhost:5001
- Backend: http://localhost:3001

### Manual Start

If you prefer to run servers separately:

1. **Start the Node.js backend**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Start the Flask frontend** (in another terminal):
   ```bash
   python3 selfaware.py
   ```

## Usage

1. **Open your browser** to http://localhost:5001
2. **Click "Start"** to activate the system
3. **Allow camera and microphone** permissions
4. **Hold the button** to record your voice
5. **Release the button** to process and get AI response
6. **Watch the emotion detection** update in real-time

## Features in Detail

### Emotion Detection
- Real-time facial emotion recognition
- Visual emotion indicator with color coding
- Emotion data forwarded to AI for context-aware responses

### Voice Processing
- Push-to-talk recording interface
- High-quality speech-to-text transcription
- Streaming AI responses with emotion awareness
- Natural voice synthesis and playback

### Integration Benefits
- **Minimal UI Changes**: Existing interface preserved
- **Enhanced Functionality**: Full voice processing pipeline
- **Real-time Processing**: Streaming responses and audio
- **Emotion Context**: AI responses adapt to detected emotions

## API Endpoints

### Flask Frontend
- `GET /`: Main application interface
- `POST /api/audio/process`: Proxy to Node.js backend for audio processing

### Node.js Backend  
- `POST /api/audio/process`: Process uploaded audio files
- `GET /health`: Backend health check
- `WebSocket /`: Real-time communication for streaming responses

## Configuration

### Environment Variables (backend/.env)
```env
# Required API Keys
DEEPGRAM_API_KEY=your_deepgram_key
INFLECTION_API_KEY=your_inflection_key
RESEMBLE_API_KEY=your_resemble_key
RESEMBLE_PROJECT_UUID=your_project_uuid
RESEMBLE_VOICE_UUID=your_voice_uuid

# Server Configuration
PORT=3001
CORS_ORIGIN=http://localhost:5001

# Optional Deepgram Settings
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=en-US
```

## Troubleshooting

### Common Issues

1. **Backend connection failed**: Ensure Node.js backend is running on port 3001
2. **Audio not working**: Check microphone permissions and API keys
3. **Emotion detection not working**: Ensure camera permissions and emotion server is running
4. **API errors**: Verify all API keys are correctly set in backend/.env

### Logs

- Backend logs: Check terminal output from Node.js server
- Frontend logs: Check browser console for client-side errors
- Audio processing logs: Located in `backend/logs/` directory

## Development

### Project Structure
```
self-aware-real/
├── selfaware.py          # Flask frontend server
├── templates/
│   └── index.html        # Main UI template
├── backend/              # Node.js backend
│   ├── src/
│   │   ├── index.ts      # Backend server entry
│   │   ├── websocket.ts  # WebSocket handling
│   │   └── services/     # Audio processing services
│   └── package.json
├── start.sh              # Startup script
└── README.md
```

### Adding Features

The integration is designed to be minimal and extensible:
- Add new API endpoints in Flask for additional features
- Extend Node.js backend for new audio processing capabilities
- Modify HTML template for UI enhancements
- Use WebSocket communication for real-time features

## License

[Add your license information here]


