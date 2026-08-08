/**
 * Direct Google Workspace API connector.
 * Handles Gmail (read/send/reply) and Calendar (list/create) operations.
 */
import { getToken, setToken } from '../token-store';
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

  private async authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new Error('Not configured');
    const headers = { Authorization: `Bearer ${this.accessToken}`, ...options.headers };
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      this.accessToken = await refreshGoogleToken(this.clientId, this.clientSecret, this.refreshToken);
      // Update stored token
      const creds = getToken('google_workspace') as Record<string, string>;
      if (creds) {
        setToken('google_workspace', { ...creds, access_token: this.accessToken });
      }
      res = await fetch(url, { ...options, headers: { ...headers, Authorization: `Bearer ${this.accessToken}` } });
    }
    return res;
  }

  private async gmailApi(path: string): Promise<any> {
    const res = await this.authFetch(`https://gmail.googleapis.com/gmail/v1${path}`);
    if (!res.ok) throw new Error(`Gmail API ${res.status}`);
    return res.json();
  }

  // ── Gmail Read ─────────────────────────────────────────────────────────────

  async listEmails(maxResults: number = 10, query: string = ''): Promise<any[]> {
    const q = query || 'is:inbox newer_than:1d';
    const list = await this.gmailApi(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`);
    if (!list.messages) return [];
    const emails = await Promise.all(
      list.messages.slice(0, 5).map(async (msg: any) => {
        const detail = await this.gmailApi(`/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const headers = detail.payload?.headers || [];
        return {
          id: detail.id,
          threadId: detail.threadId,
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
    return this.gmailApi(`/users/me/messages/${messageId}?format=full`);
  }

  // ── Gmail Write ────────────────────────────────────────────────────────────

  async sendEmail(to: string, subject: string, body: string): Promise<any> {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64url');

    const res = await this.authFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Send email failed: ${res.status}`);
    return res.json();
  }

  async replyEmail(messageId: string, threadId: string, body: string): Promise<any> {
    // Get original message to extract headers for reply
    const original = await this.gmailApi(`/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
    const headers = original.payload?.headers || [];
    const from = headers.find((h: any) => h.name === 'From')?.value || '';
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
    const msgId = headers.find((h: any) => h.name === 'Message-ID')?.value || '';

    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const raw = Buffer.from(
      `To: ${from}\r\nSubject: ${replySubject}\r\nIn-Reply-To: ${msgId}\r\nReferences: ${msgId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64url');

    const res = await this.authFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, threadId }),
    });
    if (!res.ok) throw new Error(`Reply failed: ${res.status}`);
    return res.json();
  }

  async forwardEmail(messageId: string, to: string, body: string): Promise<any> {
    const original = await this.gmailApi(`/users/me/messages/${messageId}?format=full`);
    const headers = original.payload?.headers || [];
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';

    const fwdSubject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${fwdSubject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n\r\n--- Forwarded ---\r\n${original.snippet || ''}`
    ).toString('base64url');

    const res = await this.authFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Forward failed: ${res.status}`);
    return res.json();
  }

  // ── Calendar Read ──────────────────────────────────────────────────────────

  async listCalendarEvents(timeMin?: string, timeMax?: string): Promise<any[]> {
    if (!this.accessToken) return [];
    const min = timeMin || new Date().toISOString();
    const max = timeMax || (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString(); })();

    const res = await this.authFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=10`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((e: any) => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location || '',
      description: e.description || '',
      attendees: (e.attendees || []).map((a: any) => a.email),
    }));
  }

  // ── Calendar Write ─────────────────────────────────────────────────────────

  async createCalendarEvent(title: string, startTime: string, endTime: string, description?: string, attendees?: string[]): Promise<any> {
    const event: any = {
      summary: title,
      start: { dateTime: startTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: endTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
    if (description) event.description = description;
    if (attendees && attendees.length > 0) {
      event.attendees = attendees.map((email: string) => ({ email }));
    }

    const res = await this.authFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Create event failed: ${res.status}`);
    return res.json();
  }

  async deleteCalendarEvent(eventId: string): Promise<any> {
    const res = await this.authFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) throw new Error(`Delete event failed: ${res.status}`);
    return { success: true, deleted: eventId };
  }

  // ── Google Tasks ───────────────────────────────────────────────────────────

  async listTasks(): Promise<any[]> {
    if (!this.accessToken) return [];
    // First get task lists
    const listsRes = await this.authFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    if (!listsRes.ok) return [];
    const listsData = await listsRes.json();
    const taskLists = listsData.items || [];
    
    const allTasks: any[] = [];
    // Get tasks from each list (max 2 lists to keep it fast)
    for (const list of taskLists.slice(0, 2)) {
      const tasksRes = await this.authFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false&maxResults=10`
      );
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        for (const task of (tasksData.items || [])) {
          allTasks.push({
            id: task.id,
            title: task.title || '(No title)',
            notes: task.notes || '',
            due: task.due || '',
            status: task.status,
            list: list.title,
          });
        }
      }
    }
    return allTasks;
  }
}
