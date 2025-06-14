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
@socketio.on('audio_data')
def handle_audio_data(audio_data):
    """
    Handle incoming audio data from the client
    audio_data: audio data in the agreed format (e.g., base64 encoded audio chunks)
    """
    try:
        # Process audio data here
        logger.debug("Received audio data")
        
        # Echo the audio back to the client (you can modify this based on your needs)
        emit('audio_response', audio_data)

    except Exception as e:
        logger.error(f"Error processing audio data: {str(e)}")

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    logger.info('Client connected')
    
    # Start the dummy conversation stream
    def send_dummy_conversation():
        import time
        dummy_conversation = [
            ('transcription', "Hey, can you help me with my project?"),
            ('intent', "User is requesting assistance with a project"),
            ('response', "Of course! I'd be happy to help. What kind of project are you working on?"),
            ('transcription', "I need to analyze some data"),
            ('intent', "User needs data analysis assistance"),
            ('response', "I can definitely help with data analysis. What kind of data are we working with?"),
        ]
        
        for msg_type, text in dummy_conversation:
            socketio.emit(msg_type, text)
            time.sleep(1.5)  # Add delay between messages
            
    # Run the dummy conversation in a background thread
    from threading import Thread
    Thread(target=send_dummy_conversation).start()

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info('Client disconnected')

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001)

