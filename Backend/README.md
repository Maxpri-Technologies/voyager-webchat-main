# Voyager Web Chat

Voyager is a web chat app served by an Express backend. Do not open `index.html`
directly; the website requires the backend for sign-in, subscription checks,
and chat.

## Run locally

Install Node.js 18 or later, then run:

```bash
cd Backend
Copy-Item .env.example .env
npm install
npm start
```

Open <http://localhost:3000>.

Before starting, generate a session secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
and put the generated value in `SESSION_SECRET` in `Backend/.env`. Keep this
secret stable across restarts.

Every user must sign in with Google and have an active $5/month PayPal
subscription. There is no guest access. Google sign-in also creates the
account; there is no separate password sign-up form.

## Configure Google sign-in

1. Create a Web application OAuth client in Google Cloud Console and enable
   Google Identity Services.
2. Add `http://localhost:3000` to authorized JavaScript origins. Add your
   deployed site origin when hosting outside localhost.
3. Set `GOOGLE_CLIENT_ID` in `Backend/.env`.

## Configure PayPal subscriptions

1. Create a PayPal REST app and an active subscription plan with exactly one
   billing cycle: $5 USD every 1 month, with no trial or setup fee.
2. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_PLAN_ID` in
   `Backend/.env`. Keep `PAYPAL_ENVIRONMENT=sandbox` while testing.
3. Set `SESSION_SECRET` to a long random secret and restart the backend. For
   production, use PayPal live credentials and a live plan ID, set
   `PAYPAL_ENVIRONMENT=live`, and serve the website over HTTPS.

Checkout uses PayPal's subscription button. The backend independently verifies
the plan price and billing frequency and checks the active subscription before
serving the app or chat API. The PayPal subscriber email must match the Google
account email. Canceled or inactive subscriptions lose access.

## Configure AI responses

Set `OPENAI_API_KEY` in `Backend/.env` to enable live model responses, or add an
OpenAI-compatible base URL, API key, and model in Voyager settings. Without an
AI provider key, the backend only returns a demo response; the Voyager
subscription does not include third-party AI usage charges.

Chat history and API settings are stored in browser local storage.
