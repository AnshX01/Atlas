import { BrowserWindow } from 'electron';
import { setToken } from './token-store';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = 'http://localhost:19876/oauth/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Start the Google OAuth flow in a popup window.
 * Returns the tokens on success.
 */
export async function startGoogleOAuth(clientId: string, clientSecret: string): Promise<GoogleTokens> {
  return new Promise((resolve, reject) => {
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWindow.loadURL(authUrl.toString());

    // Listen for the redirect
    authWindow.webContents.on('will-redirect', async (_event, url) => {
      await handleRedirect(url, clientId, clientSecret, authWindow, resolve, reject);
    });

    authWindow.webContents.on('will-navigate', async (_event, url) => {
      await handleRedirect(url, clientId, clientSecret, authWindow, resolve, reject);
    });

    authWindow.on('closed', () => {
      reject(new Error('OAuth window was closed by user'));
    });
  });
}

async function handleRedirect(
  url: string,
  clientId: string,
  clientSecret: string,
  authWindow: BrowserWindow,
  resolve: (tokens: GoogleTokens) => void,
  reject: (err: Error) => void
) {
  if (!url.startsWith(REDIRECT_URI)) return;

  const urlObj = new URL(url);
  const code = urlObj.searchParams.get('code');
  const error = urlObj.searchParams.get('error');

  if (error) {
    authWindow.close();
    reject(new Error(`Google OAuth error: ${error}`));
    return;
  }

  if (!code) return;

  try {
    // Exchange code for tokens
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error_description || 'Token exchange failed');
    }

    const tokens = await response.json() as GoogleTokens;

    // Store tokens
    setToken('google_workspace', {
      client_id: clientId,
      client_secret: clientSecret,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      token_type: tokens.token_type,
      expires_in: String(tokens.expires_in),
      scope: tokens.scope,
    });

    authWindow.close();
    resolve(tokens);
  } catch (err: any) {
    authWindow.close();
    reject(err);
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
