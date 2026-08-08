/**
 * Direct Gmail API connector.
 * Uses stored OAuth access token (from Google OAuth flow).
 */
import { getToken } from '../token-store';
import { refreshGoogleToken } from '../google-oauth';

export class GmailConnector {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private clientId: string | null = null;
  private clientSecret: string | null = null;

  async init(): Promise<boolean> {
    const creds = getToken('google_workspace') as Record<string, string> | null;
    if (!creds) return false;
    this.accessToken = creds.access_token || null;
    this.refreshToken = creds.refresh_token || null;
    this.clientId = creds.client_id || null;
    this.clientSecret = creds.client_secret || null;
    return !!this.accessToken;
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) return;
    // Try the current token first, refresh on 401
  }

  private async api(path: string): Promise<any> {
    if (!this.accessToken) throw new Error('Gmail not configured. Complete OAuth in Settings.');
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      // Try refresh
      this.accessToken = await refreshGoogleToken(this.clientId, this.clientSecret, this.refreshToken);
      const retry = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!retry.ok) throw new Error(`Gmail API ${retry.status}`);
      return retry.json();
    }
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async listEmails(maxResults: number = 10, query: string = ''): Promise<any[]> {
    const q = query || 'is:inbox';
    const list = await this.api(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`);
    if (!list.messages) return [];
    // Fetch details for each message
    const emails = await Promise.all(
      list.messages.slice(0, 5).map(async (msg: any) => {
        const detail = await this.api(`/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const headers = detail.payload?.headers || [];
        return {
          id: detail.id,
          subject: headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)',
          from: headers.find((h: any) => h.name === 'From')?.value || 'Unknown',
          date: headers.find((h: any) => h.name === 'Date')?.value || '',
          snippet: detail.snippet || '',
        };
      })
    );
    return emails;
  }

  async getEmail(messageId: string): Promise<any> {
    return this.api(`/users/me/messages/${messageId}?format=full`);
  }

  async sendEmail(to: string, subject: string, body: string): Promise<any> {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64url');
    
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Send failed: ${res.status}`);
    return res.json();
  }

  async listCalendarEvents(): Promise<any[]> {
    if (!this.accessToken) return [];
    const now = new Date().toISOString();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=10`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((e: any) => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location || '',
    }));
  }
}
