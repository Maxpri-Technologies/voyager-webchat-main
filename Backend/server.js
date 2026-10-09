import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const users = []; // temporary in‑memory store; replace with a database later

app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed });
  res.json({ ok: true, message: 'User registered successfully.' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret', { expiresIn: '2h' });
  res.json({ ok: true, token });
});

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token.' });
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token.' });
  }
}

app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const { messages = [], mode = 'ask', settings = {} } = req.body || {};
    const normalizedMessages = Array.isArray(messages) ? messages : [];

    if (!normalizedMessages.length) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    const systemPrompt = getSystemPrompt(mode);
    const requestSettings = {
      model: settings.apiModel || process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || 'gpt-4o-mini',
      apiKey: settings.apiKey || process.env.OPENAI_API_KEY || '',
      googleCloudProjectId: settings.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT_ID || '',
      googleCloudRegion: settings.googleCloudRegion || process.env.GOOGLE_CLOUD_REGION || 'us-central1',
      apiBaseUrl: settings.apiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    };

    const answer = await generateResponse(normalizedMessages, systemPrompt, requestSettings);
    return res.json({ answer });
  } catch (error) {
    console.error('Chat request failed:', error);
    return res.status(500).json({
      error: 'The chat backend could not generate a response.',
      detail: error.message,
    });
  }
});

app.use('/FrontEnd', express.static(path.join(WEB_ROOT, 'FrontEnd')));
app.get('/Backend/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.js'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Voyager backend running on http://localhost:${PORT}`);
});

function getSystemPrompt(mode) {
  return mode === 'agent'
    ? 'You are Voyager Agent. Break complex requests into a thoughtful plan, explain progress clearly, and provide actionable results. If code is requested, provide production-ready code.'
    : 'You are Voyager, a helpful AI companion. Answer clearly, practically, and directly.';
}

function resolveProvider(settings = {}) {
  if (process.env.OPENAI_API_KEY || settings.apiKey) {
    return 'openai';
  }
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return 'google-gemini';
  }
  if (process.env.GOOGLE_CLOUD_PROJECT_ID || settings.googleCloudProjectId) {
    return 'google-vertex';
  }
  return 'demo';
}

async function generateResponse(messages, systemPrompt, settings) {
  const provider = resolveProvider(settings);

  if (provider === 'openai') {
    return callOpenAI(messages, systemPrompt, settings);
  }

  if (provider === 'google-gemini') {
    return callGoogleGemini(messages, systemPrompt, settings);
  }

  if (provider === 'google-vertex') {
    return callVertex(messages, systemPrompt, settings);
  }

  return buildDemoResponse(messages, systemPrompt);
}

async function callOpenAI(messages, systemPrompt, settings) {
  const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildDemoResponse(messages, systemPrompt);
  }

  const response = await fetch(`${(settings.apiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || 'I did not receive a response from OpenAI.';
}

async function callGoogleGemini(messages, systemPrompt, settings) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildDemoResponse(messages, systemPrompt);
  }

  const model = settings.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Gemini request failed: ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')?.trim();
  return text || 'I did not receive a response from Google Gemini.';
}

async function callVertex(messages, systemPrompt, settings) {
  const projectId = settings.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const region = settings.googleCloudRegion || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
  const model = settings.model || process.env.GOOGLE_CLOUD_MODEL || 'gemini-2.0-flash';

  if (!projectId) {
    return buildDemoResponse(messages, systemPrompt);
  }

  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  if (!accessToken) {
    return 'Google Cloud is configured, but no access token is available. Add GOOGLE_ACCESS_TOKEN or use an OpenAI/Gemini API key.';
  }

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Vertex AI request failed: ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')?.trim();
  return text || 'I did not receive a response from Vertex AI.';
}

function buildDemoResponse(messages, systemPrompt) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || 'your question';
  return `This is the Voyager demo backend. It is ready for production use, and your message was: "${lastUserMessage}". Add an API key or Google Cloud config in the environment to connect to a real model. System mode: ${systemPrompt.slice(0, 80)}...`;
}
