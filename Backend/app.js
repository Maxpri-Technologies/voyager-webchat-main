const STORAGE_KEYS = {
  settings: 'voyager-settings',
  chats: 'voyager-chats',
  activeChat: 'voyager-active-chat',
};

const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiModel: 'gpt-4o-mini',
  googleCloudProjectId: '',
  googleCloudRegion: 'us-central1',
};

const DEFAULT_ASSISTANT_RESPONSE = "I couldn't generate a response just now. Please try again.";

const modeCopy = {
  ask: {
    systemPrompt: 'You are Voyager, a helpful AI companion. Answer clearly, practically, and directly.',
    placeholder: 'Ask Voyager anything',
  },
  agent: {
    systemPrompt: 'You are Voyager Agent. Break complex requests into a thoughtful plan, explain progress clearly, and provide actionable results. If code is requested, provide production-ready code.',
    placeholder: 'Give Voyager Agent a mission',
  },
};

const state = {
  currentMode: 'ask',
  isSidebarCollapsed: false,
  isSending: false,
  chats: [],
  activeChatId: null,
  user: null,
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

function readUser() {
  return state.user;
}

function renderAccount() {
  const user = readUser();
  const avatar = document.getElementById('profileAvatar');
  const name = document.getElementById('profileName');
  const details = document.getElementById('profileDetails');
  const action = document.getElementById('accountAction');

  if (avatar) avatar.textContent = user ? user.name.trim().charAt(0).toUpperCase() || 'V' : 'V';
  if (name) name.textContent = user ? user.name : 'Account';
  if (details) details.textContent = user ? user.email : '';
  if (action) action.textContent = 'Sign out';
}

async function handleAccountAction() {
  if (readUser()) {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Sign-out failed with status ${response.status}.`);
      }
      state.user = null;
      renderAccount();
      window.location.replace('/login');
    } catch (error) {
      console.error('Could not sign out:', error);
    }
    return;
  }

  window.location.href = '/login';
}

async function loadAccount() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.status === 401 || response.status === 403) {
      window.location.replace('/login');
      return;
    } else if (!response.ok) {
      throw new Error(`Could not load account (${response.status}).`);
    } else {
      const payload = await response.json();
      if (!payload.subscriptionActive) {
        window.location.replace('/subscribe');
        return;
      }
      state.user = payload.user;
    }
  } catch (error) {
    console.error('Could not load account:', error);
  } finally {
    renderAccount();
  }
}

function setMode(mode) {
  state.currentMode = mode;

  document.querySelectorAll('.mode-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

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
    button.innerHTML = '<span class="nav-icon">◦</span><span class="title">' + escapeHtml(chat.title) + '</span>';

    button.addEventListener('click', () => {
      state.activeChatId = chat.id;
      renderChatList();
      renderMessages(chat);
    });

    chatList.appendChild(button);
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMessages(chat) {
  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');

  if (!messagesEl || !emptyState) return;

  messagesEl.innerHTML = '';
  const hasMessages = Boolean(chat?.messages?.length);
  messagesEl.classList.toggle('visible', hasMessages);

  if (!hasMessages) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

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

function addMessage(role, content) {
  const chat = getActiveChat();
  if (!chat) {
    createChat('New journey');
  }

  const activeChat = getActiveChat();
  activeChat.messages.push({ role, content });
  persistChats();
  renderChatList();
  renderMessages(activeChat);
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
  chat.title = prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt;
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
    renderMessages(getActiveChat());
  } catch (error) {
    console.error('Chat request failed:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      error instanceof TypeError
        ? 'Could not connect to Voyager. Start the backend from the Backend folder with `npm start`, then open http://localhost:3000.'
        : `Voyager could not generate a response (${detail}). Check the server and API settings, then try again.`;
    chat.messages.push({ role: 'assistant', content: message });
    persistChats();
    renderMessages(getActiveChat());
  } finally {
    state.isSending = false;
    if (sendButton) sendButton.disabled = false;
  }
}

function toggleSidebar() {
  state.isSidebarCollapsed = !state.isSidebarCollapsed;
  document.querySelector('.sidebar')?.classList.toggle('collapsed', state.isSidebarCollapsed);
  document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed', state.isSidebarCollapsed);
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const settings = readSettings();
  document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('apiModel').value = settings.apiModel;
  document.getElementById('googleCloudProjectId').value = settings.googleCloudProjectId;
  document.getElementById('googleCloudRegion').value = settings.googleCloudRegion;
  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function buildGoogleCloudEndpoint(settings) {
  const projectId = (settings.googleCloudProjectId || '').trim();
  const region = (settings.googleCloudRegion || '').trim();

  if (!projectId || !region) {
    return null;
  }

  const model = (settings.apiModel || DEFAULT_SETTINGS.apiModel).trim();
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
}

function buildGoogleCloudBody(messages, systemPrompt) {
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  return {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
  };
}

function parseGoogleCloudResponse(payload) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  return text || 'I did not receive a response from the Google Cloud model.';
}

function handleSaveSettings() {
  const settings = {
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
    apiKey: document.getElementById('apiKey').value.trim(),
    apiModel: document.getElementById('apiModel').value.trim() || DEFAULT_SETTINGS.apiModel,
    googleCloudProjectId: document.getElementById('googleCloudProjectId').value.trim(),
    googleCloudRegion: document.getElementById('googleCloudRegion').value.trim() || DEFAULT_SETTINGS.googleCloudRegion,
  };

  saveSettings(settings);
  closeSettingsModal();
}

function handleResetSettings() {
  const defaults = { ...DEFAULT_SETTINGS };
  document.getElementById('apiBaseUrl').value = defaults.apiBaseUrl;
  document.getElementById('apiKey').value = defaults.apiKey;
  document.getElementById('apiModel').value = defaults.apiModel;
  document.getElementById('googleCloudProjectId').value = defaults.googleCloudProjectId;
  document.getElementById('googleCloudRegion').value = defaults.googleCloudRegion;
  saveSettings(defaults);
}

function attachEventListeners() {
  document.querySelector('.collapse-button')?.addEventListener('click', toggleSidebar);
  document.querySelector('.start-button')?.addEventListener('click', handleNewChat);

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });

  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  document.getElementById('settingsButton')?.addEventListener('click', openSettingsModal);
  document.getElementById('closeSettings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('saveSettings')?.addEventListener('click', handleSaveSettings);
  document.getElementById('resetSettings')?.addEventListener('click', handleResetSettings);
  document.getElementById('accountAction')?.addEventListener('click', handleAccountAction);

  document.getElementById('sendButton')?.addEventListener('click', sendPrompt);
  document.getElementById('promptInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  document.querySelector('.plus-button')?.addEventListener('click', () => {
    document.getElementById('promptInput')?.focus();
  });

  document.getElementById('settingsModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'settingsModal') {
      closeSettingsModal();
    }
  });
}

async function legacyAuthRequest() {
  const token = localStorage.getItem('voyager-token');
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ mode: state.currentMode, settings, messages }),
});
const chatData = await response.json();
}
async function signup(username, password) {
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return data;
}
function initializeApp() {
  state.chats = readChats();
  const savedActiveChat = localStorage.getItem(STORAGE_KEYS.activeChat);
  state.activeChatId = state.chats.some((chat) => chat.id === savedActiveChat) ? savedActiveChat : state.chats[0]?.id || null;

  attachEventListeners();
  renderAccount();
  loadAccount();
  setMode(state.currentMode);
  renderChatList();
  renderMessages(getActiveChat());

  const settings = readSettings();
  document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('apiModel').value = settings.apiModel;
  document.getElementById('googleCloudProjectId').value = settings.googleCloudProjectId;
  document.getElementById('googleCloudRegion').value = settings.googleCloudRegion;
}

document.addEventListener('DOMContentLoaded', initializeApp);
