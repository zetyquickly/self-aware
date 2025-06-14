from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import base64
import numpy as np
import cv2
import logging
import time
from threading import Thread

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask and SocketIO
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'  # Change this in production
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

# Video WebSocket handlers
@socketio.on('video_frame')
def handle_video_frame(frame_data):
    """
    Handle incoming video frames from the client
    frame_data: base64 encoded image data
    """
    try:
        # Decode base64 image
        encoded_data = frame_data.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Here you can process the frame
        # For now, we'll just log that we received it
        logger.debug("Received video frame")

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

