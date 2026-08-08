import { getToken } from '../token-store';

export class NotionConnector {
  private token: string | null = null;

  async init(): Promise<boolean> {
    const creds = getToken('notion') as Record<string, string> | null;
    this.token = creds?.integration_token || creds?.access_token || null;
    return !!this.token;
  }

  private async api(path: string, options: RequestInit = {}): Promise<any> {
    if (!this.token) throw new Error('Notion not configured');
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}`);
    return res.json();
  }

  async searchPages(query: string = ''): Promise<any[]> {
    const data = await this.api('/search', {
      method: 'POST',
      body: JSON.stringify({ query, page_size: 10 }),
    });
    return (data.results || []).map((p: any) => ({
      id: p.id,
      title: p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
      url: p.url,
      type: p.object,
      last_edited: p.last_edited_time,
    }));
  }

  async getPage(pageId: string): Promise<any> {
    return this.api(`/pages/${pageId}`);
  }

  async listDatabases(): Promise<any[]> {
    const data = await this.api('/search', {
      method: 'POST',
      body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 10 }),
    });
    return data.results || [];
  }

  async createPage(parentId: string, title: string, content: string): Promise<any> {
    return this.api('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: { title: { title: [{ text: { content: title } }] } },
        children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }],
      }),
    });
  }
}
