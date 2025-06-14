from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import base64
import numpy as np
import cv2
import logging
import time
import requests
from threading import Thread
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask and SocketIO
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'  # Change this in production
socketio = SocketIO(app, cors_allowed_origins="*")

# Emotion server configuration
EMOTION_SERVER_URL = "http://localhost:5139"
EMOTION_SERVER_TIMEOUT = 5  # seconds

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

def process_emotion(frame_base64: str) -> str:
    """Process frame with emotion detection server"""
    try:
        # Ensure frame_base64 is valid
        if not frame_base64:
            logger.warning("Invalid frame_base64 received")
            return "NEUTRAL"
        
        # Send to emotion server with proper JSON format
        payload = {'image_base64': frame_base64}
        headers = {'Content-Type': 'application/json'}
        
        response = requests.post(
            f"{EMOTION_SERVER_URL}/detect",
            json=payload,
            headers=headers,
            timeout=EMOTION_SERVER_TIMEOUT
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success') and data.get('detections'):
                # Get the first detected emotion
                detection = data['detections'][0]
                emotion_text = detection['emotion']
                # Extract just the emotion name (remove confidence if present)
                emotion_name = emotion_text.split('(')[0].strip().upper()
                return emotion_name
        return "NEUTRAL"
    except requests.exceptions.Timeout:
        logger.warning("Emotion server request timed out")
        return "NEUTRAL"
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Failed to connect to emotion server: {str(e)}")
        return "NEUTRAL"
    except Exception as e:
        logger.error(f"Error processing emotion: {str(e)}")
        return "NEUTRAL"

# Rate limiting for video frames
last_emotion_request = 0
EMOTION_REQUEST_INTERVAL = 1.0  # Process emotion every 1 second

# Video WebSocket handlers
@socketio.on('video_frame')
def handle_video_frame(frame_data):
    """
    Handle incoming video frames from the client
    frame_data: base64 encoded image data
    """
    try:
        global last_emotion_request
        current_time = time.time()
        
        # Rate limit emotion processing
        if current_time - last_emotion_request < EMOTION_REQUEST_INTERVAL:
            return
            
        # Validate frame data
        if not frame_data or ',' not in frame_data:
            logger.warning("Invalid frame data format")
            return

        # Extract base64 data
        try:
            encoded_data = frame_data.split(',')[1]
        except Exception as e:
            logger.error(f"Error extracting base64 data: {str(e)}")
            return

        last_emotion_request = current_time
        
        # Process emotion directly with base64 data
        emotion = process_emotion(encoded_data)
        
        # Emit emotion update
        emit('emotion_update', emotion)

    except Exception as e:
        logger.error(f"Error processing video frame: {str(e)}")

# Audio WebSocket handlers
# Store last transcription time
last_transcription_time = 0
MIN_TRANSCRIPTION_INTERVAL = 2.0  # Minimum seconds between transcriptions

@socketio.on('audio_data')
def handle_audio_data(audio_data):
    """
    Handle incoming audio data from the client
    audio_data: audio data in the agreed format (e.g., base64 encoded audio chunks)
    """
    try:
        global last_transcription_time
        current_time = time.time()

        # Only process if enough time has passed since last transcription
        if current_time - last_transcription_time >= MIN_TRANSCRIPTION_INTERVAL:
            logger.debug("Processing audio data")
            last_transcription_time = current_time
            
            # Here you would normally do actual audio processing and transcription
            # For now we'll just send empty messages for testing
            transcription_data = {
                'text': "",  # This will be replaced with actual transcription
                'streaming': False,
                'streamChange': False
            }
            emit('transcription', transcription_data)
            
            # AI response placeholder
            response_data = {
                'text': "",  # This will be replaced with actual AI response
                'streaming': True,
                'streamChange': False
            }
            emit('response', response_data)
            
            emit('audio_response', audio_data)

    except Exception as e:
        logger.error(f"Error processing audio data: {str(e)}")

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    logger.info('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info('Client disconnected')

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001)

