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

// Emotion detection proxy endpoint removed - using WebSocket instead

export default router; 