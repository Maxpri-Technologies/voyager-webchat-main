import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Voyager Web Chat' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], mode = 'ask', settings = {} } = req.body || {};
    const safeSettings = settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
      return res.status(400).json({ error: 'Provide between 1 and 100 messages.' });
    }

    const normalizedMessages = messages.map((message) => {
      if (
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        !message.content.trim() ||
        message.content.length > 20000
      ) return null;
      return { role: message.role, content: message.content.trim() };
    });
    if (normalizedMessages.some((message) => message === null)) {
      return res.status(400).json({ error: 'Each message must have a valid role and non-empty text under 20,000 characters.' });
    }

    const systemPrompt = getSystemPrompt(mode === 'agent' ? 'agent' : 'ask');
    const provider = resolveProvider(safeSettings);
    const requestSettings = {
      model: provider === 'google-gemini'
        ? (safeSettings.apiModel?.startsWith('gemini-')
          ? safeSettings.apiModel
          : process.env.GEMINI_MODEL || 'gemini-3.8-flash')
        : safeSettings.apiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      apiKey: safeSettings.apiKey || process.env.OPENAI_API_KEY || '',
      googleCloudProjectId: safeSettings.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT_ID || '',
      googleCloudRegion: safeSettings.googleCloudRegion || process.env.GOOGLE_CLOUD_REGION || 'us-central1',
      apiBaseUrl: safeSettings.apiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    };

    const answer = await generateResponse(normalizedMessages, systemPrompt, requestSettings);
    return res.json({ answer });
  } catch (error) {
    console.error('Chat request failed:', error);
    return res.status(500).json({ error: 'The chat backend could not generate a response.' });
  }
});

app.use('/FrontEnd', express.static(path.join(WEB_ROOT, 'FrontEnd')));
app.get('/Backend/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.js'));
});
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(WEB_ROOT, 'index.html'));
});
app.get('*', (req, res) => {
  res.redirect('/');
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
  if (
    (settings.apiKey && settings.apiKey === process.env.GEMINI_API_KEY) ||
    settings.apiKey?.startsWith('AIza') ||
    settings.apiModel?.startsWith('gemini-') ||
    settings.apiBaseUrl?.includes('generativelanguage.googleapis.com')
  ) {
    return 'google-gemini';
  }
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
  const apiKey = settings.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildDemoResponse(messages, systemPrompt);
  }

  const model = settings.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
  const model = settings.model || process.env.GOOGLE_CLOUD_MODEL || 'gemini-3.8-flash';

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
