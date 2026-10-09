# Voyager Web Chat

A dark, ChatGPT-inspired web chat app with Ask and Agent modes, built as a frontend-only interface that uses your configured API key and OpenAI-compatible endpoints.

## Features

- dark ChatGPT-like layout matching the reference mockup
- left sidebar with chats, pins, and projects
- `Chat` and `Work` mode switch
- API-first design using OpenAI-compatible endpoints
- no backend required; uses browser fetch calls against your API provider
- local storage for chat history and settings
- responsive layout for smaller screens

## Run it locally

Because this is a static app, you can run it in any web server:

```bash
cd Voyager-Web-Chat
python3 -m http.server 3000
```

Then open:

```text
http://localhost:3000
```

## Configure the API

Click the gear icon in the top-right corner and set:

- Base URL: `https://api.openai.com/v1`
- API Key: your secret key
- Model: `gpt-4o-mini`

You can also use compatible providers like OpenRouter by changing the base URL to something like:

```text
https://openrouter.ai/api/v1
```

Example model names for OpenRouter include:

```text
openai/gpt-4o-mini
anthropic/claude-3.5-sonnet
```

## Notes

- This app is intentionally frontend-only.
- It relies entirely on API calls from the browser.
- No data is stored server-side.
- Chat history and settings are kept in browser local storage.

## Important

This app expects an API provider that supports the OpenAI `/chat/completions` schema.

If the provider does not use that format, update the request body or endpoint accordingly.
