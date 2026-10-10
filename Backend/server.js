import express from 'express';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in Backend/.env before starting Voyager.');
}
const SESSION_SECRET = process.env.SESSION_SECRET;
const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Voyager Web Chat' });
});

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalPlanId: process.env.PAYPAL_PLAN_ID || '',
    paypalConfigured: Boolean(
      process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.PAYPAL_PLAN_ID,
    ),
    paypalEnvironment: process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
  });
});

app.get('/api/auth/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = readSignedCookie(req, 'voyager_session');
  if (!user || typeof user.email !== 'string' || typeof user.name !== 'string') {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  try {
    const subscription = await getActiveSubscriptionForUser(req, user);
    return res.json({ user, subscriptionActive: Boolean(subscription) });
  } catch (error) {
    console.error('Could not verify subscription status:', error);
    return res.status(503).json({ error: 'Could not verify your subscription right now. Please try again.' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const credential = req.body?.credential;

  if (!clientId) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }
  if (typeof credential !== 'string' || !credential || credential.length > 8192) {
    return res.status(400).json({ error: 'A Google credential is required.' });
  }

  try {
    const user = await verifyGoogleCredential(credential, clientId);
    if (!user) {
      return res.status(401).json({ error: 'Google could not verify this sign-in. Please try again.' });
    }
    res.set('Set-Cookie', makeSessionCookie('voyager_session', user, 7 * 24 * 60 * 60));
    return res.json({ user });
  } catch (error) {
    console.error('Google sign-in verification failed:', error);
    return res.status(502).json({ error: 'Google sign-in could not be verified right now.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.set('Set-Cookie', [
    makeClearCookie('voyager_session'),
    makeClearCookie('voyager_subscription'),
  ]);
  res.json({ ok: true });
});

async function requireActiveSubscription(req, res, next) {
  const user = readSignedCookie(req, 'voyager_session');
  if (!user || typeof user.email !== 'string' || typeof user.name !== 'string') {
    return res.status(401).json({ error: 'Sign in is required.' });
  }

  try {
    if (!(await getActiveSubscriptionForUser(req, user))) {
      return res.status(402).json({ error: 'An active $5/month PayPal subscription is required.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error('Could not verify subscription for protected request:', error);
    return res.status(503).json({ error: 'Could not verify your subscription right now.' });
  }
}

app.post('/api/billing/confirm', async (req, res) => {
  const user = readSignedCookie(req, 'voyager_session');
  const subscriptionId = req.body?.subscriptionId;
  if (!user) {
    return res.status(401).json({ error: 'Sign in before subscribing.' });
  }
  if (typeof subscriptionId !== 'string' || !/^I-[A-Z0-9]+$/i.test(subscriptionId)) {
    return res.status(400).json({ error: 'A valid PayPal subscription ID is required.' });
  }

  try {
    const subscription = await verifyPaypalSubscription(subscriptionId, user);
    if (!subscription) {
      return res.status(402).json({ error: 'PayPal has not confirmed an active $5/month subscription for this account.' });
    }
    res.set('Set-Cookie', makeSessionCookie(
      'voyager_subscription',
      { id: subscriptionId },
      30 * 24 * 60 * 60,
    ));
    return res.json({ ok: true });
  } catch (error) {
    console.error('Could not verify PayPal subscription:', error);
    return res.status(503).json({ error: 'Could not verify your PayPal subscription right now. Please try again.' });
  }
});

app.post('/api/chat', requireActiveSubscription, async (req, res) => {
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
    const requestSettings = {
      model: safeSettings.apiModel || process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || 'gpt-4o-mini',
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
app.get('/Backend/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.js'));
});
app.get('/Backend/subscribe.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'subscribe.js'));
});
app.get('/login', (req, res) => {
  if (readSignedCookie(req, 'voyager_session')) {
    return res.redirect('/subscribe');
  }
  res.sendFile(path.join(WEB_ROOT, 'login.html'));
});
app.get('/subscribe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = readSignedCookie(req, 'voyager_session');
  if (!user) {
    return res.redirect('/login');
  }

  try {
    if (
      process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.PAYPAL_PLAN_ID &&
      await getActiveSubscriptionForUser(req, user)
    ) {
      return res.redirect('/');
    }
    return res.sendFile(path.join(WEB_ROOT, 'subscribe.html'));
  } catch (error) {
    console.error('Could not check subscription before checkout:', error);
    return res.status(503).send('Could not verify subscription status. Please try again shortly.');
  }
});
app.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = readSignedCookie(req, 'voyager_session');
  if (!user) {
    return res.redirect('/login');
  }

  try {
    if (!(await getActiveSubscriptionForUser(req, user))) {
      return res.redirect('/subscribe');
    }
    return res.sendFile(path.join(WEB_ROOT, 'index.html'));
  } catch (error) {
    console.error('Could not verify access to Voyager:', error);
    return res.status(503).send('Could not verify your subscription. Please try again shortly.');
  }
});
app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Voyager backend running on http://localhost:${PORT}`);
});

function readCookie(req, name) {
  const prefix = `${name}=`;
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : '';
}

function signValue(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function makeSessionCookie(name, payload, maxAgeSeconds) {
  const encodedPayload = Buffer.from(JSON.stringify({
    ...payload,
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  })).toString('base64url');
  const value = `${encodedPayload}.${signValue(encodedPayload)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function makeClearCookie(name) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function readSignedCookie(req, name) {
  const value = readCookie(req, name);
  const separator = value.lastIndexOf('.');
  if (separator < 1) {
    return null;
  }

  const encodedPayload = value.slice(0, separator);
  const receivedSignature = Buffer.from(value.slice(separator + 1));
  const expectedSignature = Buffer.from(signValue(encodedPayload));
  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return Number(payload.expiresAt) > Date.now() ? payload : null;
  } catch (error) {
    console.error(`Could not parse ${name} cookie:`, error);
    return null;
  }
}

async function verifyGoogleCredential(credential, clientId) {
  if (!clientId) {
    return null;
  }

  const verificationUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
  verificationUrl.searchParams.set('id_token', credential);
  const response = await fetch(verificationUrl);
  if (!response.ok) {
    return null;
  }

  const claims = await response.json();
  const expiresAt = Number(claims.exp) * 1000;
  const issuerIsValid = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  const tokenIsValid =
    claims.aud === clientId &&
    issuerIsValid &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() &&
    (claims.email_verified === 'true' || claims.email_verified === true) &&
    typeof claims.sub === 'string' &&
    typeof claims.email === 'string';

  if (!tokenIsValid) {
    return null;
  }

  return {
    id: claims.sub,
    name: claims.name || claims.email,
    email: claims.email,
  };
}

function paypalApiBaseUrl() {
  return process.env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }

  const response = await fetch(`${paypalApiBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) {
    throw new Error(`PayPal authentication failed with status ${response.status}.`);
  }

  const payload = await response.json();
  if (typeof payload.access_token !== 'string') {
    throw new Error('PayPal did not return an access token.');
  }
  return payload.access_token;
}

async function verifyPaypalSubscription(subscriptionId, user) {
  const planId = process.env.PAYPAL_PLAN_ID;
  if (!planId) {
    throw new Error('PayPal is not configured. Set PAYPAL_PLAN_ID.');
  }

  const accessToken = await getPayPalAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [planResponse, subscriptionResponse] = await Promise.all([
    fetch(`${paypalApiBaseUrl()}/v1/billing/plans/${encodeURIComponent(planId)}`, { headers }),
    fetch(`${paypalApiBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers }),
  ]);

  if (!planResponse.ok) {
    throw new Error(`Could not verify the PayPal plan (status ${planResponse.status}).`);
  }
  if (subscriptionResponse.status === 404) {
    return null;
  }
  if (!subscriptionResponse.ok) {
    throw new Error(`Could not verify the PayPal subscription (status ${subscriptionResponse.status}).`);
  }

  const [plan, subscription] = await Promise.all([
    planResponse.json(),
    subscriptionResponse.json(),
  ]);
  const billingCycles = plan.billing_cycles || [];
  const monthlyFiveDollarPlan =
    plan.status === 'ACTIVE' &&
    Number(plan.payment_preferences?.setup_fee?.value || 0) === 0 &&
    billingCycles.length === 1 &&
    billingCycles[0].tenure_type === 'REGULAR' &&
    billingCycles[0].frequency?.interval_unit === 'MONTH' &&
    Number(billingCycles[0].frequency?.interval_count) === 1 &&
    billingCycles[0].pricing_scheme?.fixed_price?.currency_code === 'USD' &&
    Number(billingCycles[0].pricing_scheme?.fixed_price?.value) === 5;
  if (
    !monthlyFiveDollarPlan ||
    subscription.id !== subscriptionId ||
    subscription.plan_id !== planId ||
    subscription.status !== 'ACTIVE' ||
    subscription.custom_id !== user.id
  ) {
    return null;
  }

  return subscription;
}

async function getActiveSubscriptionForUser(req, user) {
  const subscription = readSignedCookie(req, 'voyager_subscription');
  if (!subscription || typeof subscription.id !== 'string') {
    return null;
  }
  return verifyPaypalSubscription(subscription.id, user);
}

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
