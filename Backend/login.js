const statusElement = document.getElementById('loginStatus');
const buttonContainer = document.getElementById('googleSignIn');

function showLoginStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function showServerRequiredMessage() {
  showLoginStatus('This page was opened as a local file, so Google sign-in cannot connect to Voyager. Start the backend and open the website from its local server.');

  const serverLink = document.createElement('a');
  serverLink.href = 'http://localhost:3000/login';
  serverLink.textContent = 'Open Voyager sign-in';
  serverLink.className = 'login-server-link';
  statusElement.append(' ', serverLink);
}

async function handleGoogleCredential(response) {
  showLoginStatus('Verifying your Google account…');

  try {
    const result = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const payload = await result.json();

    if (!result.ok) {
      throw new Error(payload.error || `Sign-in failed with status ${result.status}.`);
    }

    window.location.assign('/');
  } catch (error) {
    console.error('Google sign-in failed:', error);
    showLoginStatus(error.message || 'Google sign-in failed. Please try again.', true);
  }
}

async function initializeGoogleSignIn() {
  if (window.location.protocol === 'file:') {
    showServerRequiredMessage();
    return;
  }

  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`Could not load sign-in settings (${response.status}).`);
    }

    const { googleClientId } = await response.json();
    if (!googleClientId) {
      showLoginStatus('Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID in Backend/.env, then restart Voyager.', true);
      return;
    }

    if (!window.google?.accounts?.id) {
      showLoginStatus('Google sign-in could not load. Check your connection and refresh.', true);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
    });
    document.getElementById('googleSignInPlaceholder')?.remove();
    window.google.accounts.id.renderButton(buttonContainer, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      width: 320,
    });
  } catch (error) {
    console.error('Could not initialize Google sign-in:', error);
    showLoginStatus(error.message || 'Could not load sign-in settings.', true);
  }
}

window.addEventListener('load', initializeGoogleSignIn);
