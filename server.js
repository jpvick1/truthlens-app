const express = require('express');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai-detector-app.html'));
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const base64Image = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const prompt = 'You are an AI image forensics expert. Analyze this image and determine if it is AI-generated or a real photograph. Respond ONLY with a valid JSON object with these exact fields: score (integer 0-100 where 0=real and 100=AI), verdict (one of: Likely real, Possibly AI, Likely AI, Almost certainly AI), signals (array of objects with label, detail, and type fields where type is ai or real or neutral), summary (2-3 sentence assessment). Include 4-5 signals.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      }),
    });

    const data = await response.json();
    const text = data.content.map(function(b) { return b.text || ''; }).join('');
    const clean = text.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(clean));

  } catch (err) {
    console.error('Full error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('TruthLens running on port ' + PORT);
});
