const statusElement = document.getElementById('subscriptionStatus');
const buttonContainer = document.getElementById('paypalButton');

function showSubscriptionStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function loadPayPalSdk(clientId, environment) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const host = environment === 'live' ? 'www.paypal.com' : 'www.sandbox.paypal.com';
    const sdkUrl = new URL(`https://${host}/sdk/js`);
    sdkUrl.searchParams.set('client-id', clientId);
    sdkUrl.searchParams.set('vault', 'true');
    sdkUrl.searchParams.set('intent', 'subscription');
    script.src = sdkUrl.toString();
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load PayPal checkout. Check your connection and PayPal settings.'));
    document.head.appendChild(script);
  });
}

async function confirmSubscription(subscriptionId) {
  const response = await fetch('/api/billing/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptionId }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Subscription verification failed (${response.status}).`);
  }
  window.location.assign('/');
}

async function initializeCheckout() {
  try {
    const [configResponse, accountResponse] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/auth/me'),
    ]);
    if (accountResponse.status === 401 || accountResponse.status === 403) {
      window.location.replace('/login');
      return;
    }
    if (!accountResponse.ok) {
      throw new Error(`Could not verify your account (${accountResponse.status}).`);
    }

    const account = await accountResponse.json();
    if (account.subscriptionActive) {
      window.location.replace('/');
      return;
    }
    if (!configResponse.ok) {
      throw new Error(`Could not load checkout settings (${configResponse.status}).`);
    }

    const config = await configResponse.json();
    if (!config.paypalConfigured || !config.paypalClientId || !config.paypalPlanId) {
      showSubscriptionStatus('PayPal checkout is not configured. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_PLAN_ID in Backend/.env.', true);
      return;
    }

    await loadPayPalSdk(config.paypalClientId, config.paypalEnvironment);
    if (!window.paypal?.Buttons) {
      throw new Error('PayPal checkout did not initialize. Verify the configured PayPal client and plan.');
    }

    await window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'subscribe' },
      createSubscription(_data, actions) {
        return actions.subscription.create({
          plan_id: config.paypalPlanId,
          custom_id: account.user.id,
        });
      },
      async onApprove(data) {
        showSubscriptionStatus('Confirming your subscription securely…');
        try {
          await confirmSubscription(data.subscriptionID);
        } catch (error) {
          console.error('Subscription confirmation failed:', error);
          showSubscriptionStatus(error.message || 'Could not confirm your subscription.', true);
        }
      },
      onError(error) {
        console.error('PayPal checkout failed:', error);
        showSubscriptionStatus('PayPal checkout failed. Please try again.', true);
      },
    }).render(buttonContainer);
    showSubscriptionStatus('Your subscription will be verified before access is granted.');
  } catch (error) {
    console.error('Could not initialize subscription checkout:', error);
    showSubscriptionStatus(error.message || 'Could not load secure checkout.', true);
  }
}

document.getElementById('signOutButton').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Sign-out failed (${response.status}).`);
    }
    window.location.replace('/login');
  } catch (error) {
    console.error('Could not sign out:', error);
    showSubscriptionStatus(error.message || 'Could not sign out.', true);
  }
});

initializeCheckout();
