# Voyager MVP

Voyager is a minimal AI chat app. The Express server serves the app and sends
chat requests to an AI provider. Chat history and browser-configured API
settings stay in local storage.

## Run

Install Node.js 18 or later, then run:

```powershell
cd Backend
Copy-Item .env.example .env
npm install
npm start
```

Open <http://localhost:3000>. The app works in demo mode without an AI key.
For real responses, add `OPENAI_API_KEY` to `Backend/.env`, or enter an
OpenAI-compatible base URL, API key, and model in Settings.
