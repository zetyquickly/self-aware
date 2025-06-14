import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { processAudioPipeline, listResembleVoices } from '../services/audioPipeline';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/process', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const sessionId = req.body.sessionId || `session_${Date.now()}`;
    const audioBuffer = req.file.buffer;

    // Start the audio processing pipeline
    const result = await processAudioPipeline(audioBuffer, sessionId);

    return res.json({
      success: true,
      sessionId,
      transcription: result.transcription
    });
  } catch (error) {
    console.error('Audio processing error:', error);
    return res.status(500).json({ error: 'Failed to process audio' });
  }
});

router.get('/voices', async (req, res) => {
  try {
    await listResembleVoices();
    return res.json({ message: 'Check console for available voices' });
  } catch (error) {
    console.error('Error listing voices:', error);
    return res.status(500).json({ error: 'Failed to list voices' });
  }
});

// Emotion detection proxy to avoid CORS issues
router.post('/emotion', async (req, res) => {
  try {
    const { image_base64 } = req.body;
    
    if (!image_base64) {
      return res.status(400).json({ error: 'No image_base64 provided' });
    }

    console.log('Proxying emotion detection request to localhost:5139');
    
    // Forward request to emotion server
    const response = await axios.post('http://localhost:5139/detect', {
      image_base64
    }, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Emotion server responded:', response.status);
    return res.json(response.data);
    
  } catch (error) {
    console.error('Emotion proxy error:', error);
    if (axios.isAxiosError(error)) {
      return res.status(500).json({ 
        error: 'Emotion server error', 
        details: error.message,
        serverRunning: error.code !== 'ECONNREFUSED'
      });
    }
    return res.status(500).json({ error: 'Failed to process emotion detection' });
  }
});

export default router; 