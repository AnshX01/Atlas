import { getToken } from '../token-store';

export class SlackConnector {
  private token: string | null = null;

  async init(): Promise<boolean> {
    const creds = getToken('slack') as Record<string, string> | null;
    this.token = creds?.bot_token || creds?.access_token || null;
    return !!this.token;
  }

  private async api(method: string, params: Record<string, string> = {}): Promise<any> {
    // Sync memory with disk for cross-device updates
    const creds = getToken('slack') as Record<string, string> | null;
    const currentToken = creds?.bot_token || creds?.access_token || null;
    if (currentToken && currentToken !== this.token) {
      this.token = currentToken;
    }

    if (!this.token) throw new Error('Slack not configured');
    const url = new URL(`https://slack.com/api/${method}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  async listChannels(): Promise<any[]> {
    const data = await this.api('conversations.list', { types: 'public_channel,private_channel', limit: '20' });
    return data.channels || [];
  }

  async listMessages(channel: string, limit: string = '10'): Promise<any[]> {
    const data = await this.api('conversations.history', { channel, limit });
    return data.messages || [];
  }

  async listUnread(): Promise<any[]> {
    // Get channels with unread
    const data = await this.api('conversations.list', { types: 'im,mpim,public_channel,private_channel', limit: '50' });
    const unread = (data.channels || []).filter((c: any) => c.unread_count > 0);
    return unread;
  }

  async postMessage(channel: string, text: string): Promise<any> {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text }),
    });
    return res.json();
  }
}
