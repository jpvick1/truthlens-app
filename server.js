require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai-detector-app.html'));
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please wait.' },
});
app.use('/api/', limiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type.'));
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not set.' });

    const base64Image = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
            { type: 'text', text: `You are an expert AI image forensics analyst. Analyze this image and determine if it is AI-generated or a real photograph. Respond ONLY with a valid JSON object — no markdown, no backticks, no explanation outside the JSON.

{
  "score": <integer 0-100, where 0=definitely real photo, 100=definitely AI-generated>,
  "verdict": <one of: "Likely real" | "Possibly AI" | "Likely AI" | "Almost certainly AI">,
  "signals": [
    { "label": "<short name>", "detail": "<one sentence explanation>", "type": <"ai" | "real" | "neutral"> }
  ],
  "summary": "<2-3 sentence overall assessment explaining your reasoning>"
}

Include 4-5 signals. Look for: unnatural textures, inconsistent lighting, facial anomalies, background artifacts, perfect symmetry, overly smooth skin, impossible geometry, hallucinated text, and other AI artifacts.` }
          ]
        }]
      }),
    });

    if (!anthropicResponse.ok) {
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await anthropicResponse.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(500).json({ error: 'Failed to parse response.' }); }

    return res.json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error.' });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 15MB.' });
  res.status(500).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TruthLens running on port ${PORT}`);
});
