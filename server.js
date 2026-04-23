/**
 * TruthLens — Backend Server
 * Node.js + Express API proxy for the Anthropic Claude Vision API
 *
 * SETUP:
 *   1. npm install express cors dotenv express-rate-limit multer
 *   2. Create a .env file with your ANTHROPIC_API_KEY
 *   3. node server.js
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fetch = require('node-fetch'); // npm install node-fetch@2

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*', // Set to your frontend domain in production
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public')); // Serve your frontend HTML from /public folder

// Rate limiting — 20 requests per user per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please wait before trying again.' },
});
app.use('/api/', limiter);

// Multer for handling file uploads (stores in memory, not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type. Please upload an image.'));
  }
});

// ── Routes ─────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Main analysis endpoint — accepts multipart/form-data with an "image" field
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server misconfiguration: API key not set.' });
    }

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
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Image },
              },
              {
                type: 'text',
                text: `You are an expert AI image forensics analyst. Analyze this image and determine if it is AI-generated or a real photograph. Respond ONLY with a valid JSON object — no markdown, no backticks, no explanation outside the JSON.

{
  "score": <integer 0-100, where 0=definitely real photo, 100=definitely AI-generated>,
  "verdict": <one of: "Likely real" | "Possibly AI" | "Likely AI" | "Almost certainly AI">,
  "signals": [
    { "label": "<short name>", "detail": "<one sentence explanation>", "type": <"ai" | "real" | "neutral"> }
  ],
  "summary": "<2-3 sentence overall assessment explaining your reasoning>"
}

Include 4-5 signals. Look for: unnatural textures, inconsistent lighting, facial anomalies, background artifacts, perfect symmetry, watermarks, metadata patterns, overly smooth skin, impossible geometry, prompt-like compositions, hallucinated text, and other telltale AI artifacts.`,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errData = await anthropicResponse.json().catch(() => ({}));
      console.error('Anthropic API error:', errData);
      return res.status(502).json({ error: 'AI analysis service error. Please try again.' });
    }

    const data = await anthropicResponse.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    return res.json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error.' });
  }
});

// ── Error handler ──────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 15MB.' });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Something went wrong.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`TruthLens server running on http://localhost:${PORT}`);
});
