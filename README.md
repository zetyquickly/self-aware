# Self Aware

A Flask application that handles real-time video and audio streaming through WebSocket connections.

## Prerequisites

- Python 3.8 or higher
- uv package manager

## Installation

1. First, install uv if you haven't already:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh

2. Create a new virtual environment and activate it:
```bash
uv venv
source .venv/bin/activate  # On Unix/macOS
# or
.venv\Scripts\activate  # On Windows
```

3. Install dependencies using uv:
```bash
uv pip install flask flask-socketio opencv-python numpy
```

## Project Structure

```
.
├── README.md
├── selfaware.py
└── templates
    └── index.html
```

## Running the Application

1. Make sure your virtual environment is activated
2. Run the Flask application:
```bash
python selfaware.py
```
3. Open your web browser and navigate to:
```
http://localhost:5000
```

## Usage

1. When you open the application in your browser, you'll be prompted to allow camera and microphone access
2. Click the "Start" button to begin streaming video and audio
3. Click the "Stop" button to stop the streams

## Features

- Real-time video streaming from browser to server
- Bidirectional audio communication
- WebSocket-based communication for low latency
- Basic video and audio processing capabilities

## Development

The main components of the application are:

- `selfaware.py`: The main Flask application with WebSocket handlers
- `templates/index.html`: The frontend interface with video/audio capture and streaming logic

To modify video processing, edit the `handle_video_frame` function in `selfaware.py`.
To modify audio processing, edit the `handle_audio_data` function in `selfaware.py`.

## Troubleshooting

If you encounter any issues:

1. Make sure all dependencies are properly installed
2. Check that your browser supports WebRTC
3. Allow camera and microphone permissions in your browser
4. Check the console logs in both browser and server for error messages

## License


