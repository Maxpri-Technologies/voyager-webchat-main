# Voyager Web Chat

Voyager is a web chat app served by an Express backend. The backend serves the
website and handles chat requests, so run it instead of opening `index.html`
directly or starting a static-only web server.

## Run locally

```bash
cd Backend
npm install
npm start
```

Open <http://localhost:3000>.

Without provider credentials, chat returns a demo response. To get live model
responses, either enter an OpenAI-compatible API base URL, API key, and model
in the website's settings, or configure `OPENAI_API_KEY` in a `Backend/.env`
file. See `.env.example` for supported environment variables.

Chat history and website settings are stored in the browser's local storage.
