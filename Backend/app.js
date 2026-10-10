const STORAGE_KEYS = {
  settings: 'voyager-settings',
  chats: 'voyager-chats',
  activeChat: 'voyager-active-chat',
};

const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiModel: 'gpt-4o-mini',
};

const DEFAULT_ASSISTANT_RESPONSE = "I couldn't generate a response just now. Please try again.";

const modeCopy = {
  ask: {
    placeholder: 'Ask Voyager anything',
  },
  agent: {
    placeholder: 'Give Voyager Agent a mission',
  },
};

const state = {
  currentMode: 'ask',
  isSending: false,
  chats: [],
  activeChatId: null,
};

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function readChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.chats) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function persistChats() {
  localStorage.setItem(STORAGE_KEYS.chats, JSON.stringify(state.chats));
  if (state.activeChatId) {
    localStorage.setItem(STORAGE_KEYS.activeChat, state.activeChatId);
  }
}

function setMode(mode) {
  state.currentMode = mode;

  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) modeSelect.value = mode;
  const promptInput = document.getElementById('promptInput');
  if (promptInput) {
    promptInput.placeholder = modeCopy[mode].placeholder;
  }
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || null;
}

function createChat(title = 'New journey') {
  const chat = {
    id: `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    messages: [],
  };

  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  persistChats();
  renderChatList();
  renderMessages(chat);
}

function renderChatList() {
  const chatList = document.getElementById('chatList');
  if (!chatList) return;

  chatList.innerHTML = '';

  state.chats.forEach((chat) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
    button.dataset.chatId = chat.id;
    button.textContent = chat.title;

    button.addEventListener('click', () => {
      state.activeChatId = chat.id;
      renderChatList();
      renderMessages(chat);
    });

    chatList.appendChild(button);
  });
}

function renderMessages(chat) {
  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');

  if (!messagesEl || !emptyState) return;

  messagesEl.innerHTML = '';
  const hasMessages = Boolean(chat?.messages?.length);
  messagesEl.classList.toggle('visible', hasMessages);

  emptyState.hidden = hasMessages;
  if (!hasMessages) return;

  chat.messages.forEach((message) => {
    const row = document.createElement('div');
    row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message.content;

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function handleNewChat() {
  const input = document.getElementById('promptInput');
  if (input) input.focus();

  createChat('New journey');
}

async function sendPrompt() {
  const promptInput = document.getElementById('promptInput');
  if (!promptInput || state.isSending) return;

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  if (!state.activeChatId || !state.chats.some((chat) => chat.id === state.activeChatId)) {
    createChat('New journey');
  }

  const chat = getActiveChat();
  state.isSending = true;
  const sendButton = document.getElementById('sendButton');
  if (sendButton) sendButton.disabled = true;

  chat.messages.push({ role: 'user', content: prompt });
  chat.title = prompt.length > 24 ? `${prompt.slice(0, 24)}...` : prompt;
  persistChats();
  renderChatList();
  renderMessages(chat);

  promptInput.value = '';

  const settings = readSettings();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: state.currentMode,
        settings,
        messages: chat.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend request failed with status ${response.status}`);
    }
    const payload = await response.json();
    const answer =
      typeof payload.answer === 'string' && payload.answer.trim()
        ? payload.answer
        : DEFAULT_ASSISTANT_RESPONSE;

    chat.messages.push({ role: 'assistant', content: answer });
    persistChats();
    if (state.activeChatId === chat.id) renderMessages(chat);
  } catch (error) {
    console.error('Chat request failed:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      error instanceof TypeError
        ? 'Could not connect to Voyager. Start the backend from the Backend folder with `npm start`, then open http://localhost:3000.'
        : `Voyager could not generate a response (${detail}). Check the server and API settings, then try again.`;
    chat.messages.push({ role: 'assistant', content: message });
    persistChats();
    if (state.activeChatId === chat.id) renderMessages(chat);
  } finally {
    state.isSending = false;
    if (sendButton) sendButton.disabled = false;
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const settings = readSettings();
  document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('apiModel').value = settings.apiModel;
  modal.showModal();
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal?.open) modal.close();
}

function handleSaveSettings() {
  const settings = {
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
    apiKey: document.getElementById('apiKey').value.trim(),
    apiModel: document.getElementById('apiModel').value.trim() || DEFAULT_SETTINGS.apiModel,
  };

  saveSettings(settings);
  closeSettingsModal();
}

function handleResetSettings() {
  const defaults = { ...DEFAULT_SETTINGS };
  document.getElementById('apiBaseUrl').value = defaults.apiBaseUrl;
  document.getElementById('apiKey').value = defaults.apiKey;
  document.getElementById('apiModel').value = defaults.apiModel;
  saveSettings(defaults);
}

function attachEventListeners() {
  document.getElementById('newChatButton')?.addEventListener('click', handleNewChat);
  document.getElementById('modeSelect')?.addEventListener('change', (event) => setMode(event.target.value));

  document.getElementById('settingsButton')?.addEventListener('click', openSettingsModal);
  document.getElementById('closeSettings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('saveSettings')?.addEventListener('click', handleSaveSettings);
  document.getElementById('resetSettings')?.addEventListener('click', handleResetSettings);

  document.getElementById('composerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendPrompt();
  });
  document.getElementById('settingsForm')?.addEventListener('submit', (event) => event.preventDefault());
}

function initializeApp() {
  state.chats = readChats();
  const savedActiveChat = localStorage.getItem(STORAGE_KEYS.activeChat);
  state.activeChatId = state.chats.some((chat) => chat.id === savedActiveChat) ? savedActiveChat : state.chats[0]?.id || null;

  attachEventListeners();
  setMode(state.currentMode);
  renderChatList();
  renderMessages(getActiveChat());

  const settings = readSettings();
  document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('apiModel').value = settings.apiModel;
}

document.addEventListener('DOMContentLoaded', initializeApp);
