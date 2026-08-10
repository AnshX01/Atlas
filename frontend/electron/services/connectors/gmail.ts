/**
 * Direct Google Workspace API connector.
 * Handles Gmail (read/send/reply) and Calendar (list/create) operations.
 */
import { getToken, setToken } from '../token-store';
import { refreshGoogleToken } from '../google-oauth';

class SimpleLRU<K, V> {
  private cache = new Map<K, V>();
  constructor(private capacity: number) {}
  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

export class GmailConnector {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private emailCache = new SimpleLRU<string, any[]>(20);

  async init(): Promise<boolean> {
    const creds = getToken('google_workspace') as Record<string, string> | null;
    if (!creds) return false;
    this.accessToken = creds.access_token || null;
    this.refreshToken = creds.refresh_token || null;
    this.clientId = creds.client_id || null;
    this.clientSecret = creds.client_secret || null;
    return !!this.accessToken;
  }

  private async authFetch(url: string, options: RequestInit = {}, attempt: number = 1): Promise<Response> {
    if (!this.accessToken) throw new Error('Not configured');
    const headers = { Authorization: `Bearer ${this.accessToken}`, ...options.headers };
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      try {
        this.accessToken = await refreshGoogleToken(this.clientId, this.clientSecret, this.refreshToken);
        // Update stored token — preserve all existing fields
        const creds = getToken('google_workspace') as Record<string, string> | null;
        if (creds) {
          setToken('google_workspace', { ...creds, access_token: this.accessToken });
        } else {
          // Fallback: persist using instance fields so refreshed token isn't lost
          setToken('google_workspace', {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
            access_token: this.accessToken,
          });
        }
        res = await fetch(url, { ...options, headers: { ...headers, Authorization: `Bearer ${this.accessToken}` } });
      } catch (err: any) {
        throw new Error(`Google token refresh failed. Please re-authenticate in Settings. (${err.message})`);
      }
    } else if (res.status === 401) {
      throw new Error('Google token expired and no refresh token available. Please re-authenticate in Settings.');
    }
    
    if (res.status === 429) {
      if (attempt <= 3) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.authFetch(url, options, attempt + 1);
      } else {
        throw new Error('Google Workspace rate limit exceeded. Please try again later.');
      }
    }
    
    if (res.status === 403) {
      throw new Error('Google Workspace permission denied. Please re-connect and grant required permissions.');
    }
    
    return res;
  }

  private async gmailApi(path: string): Promise<any> {
    const res = await this.authFetch(`https://gmail.googleapis.com/gmail/v1${path}`);
    if (!res.ok) throw new Error(`Gmail API ${res.status}`);
    return res.json();
  }

  // ── Gmail Read ─────────────────────────────────────────────────────────────

  async listEmails(maxResults: number = 10, query: string = '', skipCache: boolean = false): Promise<any[]> {
    const q = query || 'is:inbox newer_than:1d';
    const cacheKey = `${maxResults}_${q}`;

    if (!skipCache) {
      const cached = this.emailCache.get(cacheKey);
      if (cached) return cached;
    }

    const list = await this.gmailApi(`/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`);
    if (!list.messages || list.messages.length === 0) return [];
    
    const boundary = 'batch_gmail_boundary';
    let batchBody = '';
    
    const messagesToFetch = list.messages.slice(0, 5);
    
    messagesToFetch.forEach((msg: any, i: number) => {
      batchBody += `--${boundary}\r\n`;
      batchBody += `Content-Type: application/http\r\n`;
      batchBody += `Content-ID: <item${i}>\r\n\r\n`;
      batchBody += `GET /gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date\r\n\r\n`;
    });
    batchBody += `--${boundary}--\r\n`;

    const res = await this.authFetch('https://gmail.googleapis.com/batch/gmail/v1', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/mixed; boundary=${boundary}`
      },
      body: batchBody
    });

    if (!res.ok) throw new Error(`Batch Gmail fetch failed: ${res.status}`);
    
    const batchText = await res.text();
    const emails: any[] = [];
    
    const parts = batchText.split(/--batch_[^\r\n]+/);
    for (const part of parts) {
      if (part.includes('{')) {
        const jsonStr = part.substring(part.indexOf('{'), part.lastIndexOf('}') + 1);
        try {
          const detail = JSON.parse(jsonStr);
          if (detail.id) {
            const headers = detail.payload?.headers || [];
            emails.push({
              id: detail.id,
              threadId: detail.threadId,
              subject: headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)',
              from: headers.find((h: any) => h.name === 'From')?.value || 'Unknown',
              date: headers.find((h: any) => h.name === 'Date')?.value || '',
              snippet: detail.snippet || '',
            });
          }
        } catch (e) {}
      }
    }
    
    this.emailCache.set(cacheKey, emails);
    return emails;
  }

  async getEmail(messageId: string): Promise<any> {
    return this.gmailApi(`/users/me/messages/${messageId}?format=full`);
  }

  // ── Gmail Write ────────────────────────────────────────────────────────────

  async sendEmail(to: string, subject: string, body: string): Promise<any> {
    // Validate recipient — fail fast rather than sending to garbage
    if (!to || !to.includes('@')) {
      throw new Error(`Invalid recipient email address: "${to || '(empty)'}". Cannot send email without a valid 'to' address.`);
    }

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
    // Validate messageId/threadId
    if (!messageId) {
      throw new Error('Cannot reply: missing messageId. The original email could not be identified.');
    }

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
    // Validate recipient — fail fast rather than forwarding to garbage
    if (!to || !to.includes('@')) {
      throw new Error(`Invalid recipient email address: "${to || '(empty)'}". Cannot forward email without a valid 'to' address.`);
    }
    if (!messageId) {
      throw new Error('Cannot forward: missing messageId. The original email could not be identified.');
    }

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

  // ── Google Tasks Write ─────────────────────────────────────────────────────

  async createTask(listId: string, title: string, notes?: string, due?: string): Promise<any> {
    const body: Record<string, any> = { title };
    if (notes) body.notes = notes;
    if (due) body.due = due;

    const res = await this.authFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Create task failed: ${res.status}`);
    return res.json();
  }

  async updateTask(listId: string, taskId: string, updates: Record<string, any>): Promise<any> {
    const body: Record<string, any> = {};
    if (updates.title) body.title = updates.title;
    if (updates.notes !== undefined) body.notes = updates.notes;
    if (updates.due !== undefined) body.due = updates.due;
    if (updates.status) body.status = updates.status;

    const res = await this.authFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Update task failed: ${res.status}`);
    return res.json();
  }

  async completeTask(listId: string, taskId: string): Promise<any> {
    const res = await this.authFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (!res.ok) throw new Error(`Complete task failed: ${res.status}`);
    return res.json();
  }
}
