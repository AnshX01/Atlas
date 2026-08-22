import { shell } from 'electron';
import { setToken } from './token-store';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_OAUTH_PORT = 19876;
let oauthPort = DEFAULT_OAUTH_PORT;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Set the OAuth redirect port dynamically (called from main.ts once server binds).
 */
export function setOAuthRedirectPort(port: number): void {
  oauthPort = port;
}

function getRedirectUri(): string {
  return `http://localhost:${oauthPort}/oauth/callback`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// Store pending OAuth resolve/reject so the HTTP server callback can complete the flow
let pendingOAuth: {
  clientId: string;
  clientSecret: string;
  resolve: (tokens: GoogleTokens) => void;
  reject: (err: Error) => void;
} | null = null;

/**
 * Start the Google OAuth flow in the system browser.
 * The OAuth callback is handled by the HTTP server in main.ts on port 19876.
 */
export async function startGoogleOAuth(clientId: string, clientSecret: string): Promise<GoogleTokens> {
  const cleanClientId = clientId.trim().replace(/^["']|["']$/g, '');
  const cleanClientSecret = clientSecret.trim().replace(/^["']|["']$/g, '');

  if (pendingOAuth) {
    pendingOAuth.reject(new Error('A new OAuth flow was started'));
    pendingOAuth = null;
  }

  return new Promise((resolve, reject) => {
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', cleanClientId);
    authUrl.searchParams.set('redirect_uri', getRedirectUri());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', 'connector_oauth');

    // Store the pending promise so the callback handler can resolve it
    const currentOAuth = { clientId: cleanClientId, clientSecret: cleanClientSecret, resolve, reject };
    pendingOAuth = currentOAuth;

    // Open in system browser
    shell.openExternal(authUrl.toString());

    // Timeout after 3 minutes
    setTimeout(() => {
      if (pendingOAuth === currentOAuth) {
        pendingOAuth = null;
        reject(new Error('OAuth timed out. Please try again.'));
      }
    }, 180000);
  });
}

/**
 * Called by the OAuth HTTP server in main.ts when it receives the callback.
 * Exchanges the authorization code for tokens.
 */
export async function handleOAuthCallback(code: string): Promise<GoogleTokens> {
  if (!pendingOAuth) {
    throw new Error('No pending OAuth flow');
  }

  const { clientId, clientSecret, resolve, reject } = pendingOAuth;
  pendingOAuth = null;

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      const err = new Error(errData.error_description || 'Token exchange failed');
      reject(err);
      throw err;
    }

    const tokens = await response.json() as GoogleTokens;

    // Store tokens in the Electron token store
    setToken('google_workspace', {
      client_id: clientId,
      client_secret: clientSecret,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      token_type: tokens.token_type,
      expires_in: String(tokens.expires_in),
      scope: tokens.scope,
    });

    resolve(tokens);
    return tokens;
  } catch (err: any) {
    reject(err);
    throw err;
  }
}

/**
 * Check if there's a pending OAuth flow waiting for a callback.
 */
export function hasPendingOAuth(): boolean {
  return pendingOAuth !== null;
}

/**
 * Cancel a pending OAuth flow (e.g., if user closed the browser).
 */
export function cancelPendingOAuth(): void {
  if (pendingOAuth) {
    pendingOAuth.reject(new Error('OAuth cancelled'));
    pendingOAuth = null;
  }
}

/**
 * Refresh an expired Google access token.
 */
export async function refreshGoogleToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh Google token');
  }

  const data = await response.json();
  return data.access_token;
}
