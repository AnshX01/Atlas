import { getToken } from '../token-store';

export class NotionConnector {
  private token: string | null = null;

  async init(): Promise<boolean> {
    const creds = getToken('notion') as Record<string, string> | null;
    this.token = creds?.integration_token || creds?.access_token || null;
    return !!this.token;
  }

  private async api(path: string, options: RequestInit = {}): Promise<any> {
    // Sync memory with disk for cross-device updates
    const creds = getToken('notion') as Record<string, string> | null;
    const currentToken = creds?.integration_token || creds?.access_token || null;
    if (currentToken && currentToken !== this.token) {
      this.token = currentToken;
    }

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

  /**
   * Get a default parent page ID by searching for any accessible page.
   * Checks cached value in token-store first, then falls back to Notion search.
   */
  async getDefaultParent(): Promise<string | null> {
    // Check if a default parent is cached in token-store credentials
    const creds = getToken('notion') as Record<string, string> | null;
    if (creds?.default_parent_page_id) {
      return creds.default_parent_page_id;
    }

    // Search for any accessible page
    try {
      const data = await this.api('/search', {
        method: 'POST',
        body: JSON.stringify({
          filter: { property: 'object', value: 'page' },
          page_size: 1,
        }),
      });
      const results = data.results || [];
      if (results.length > 0) {
        return results[0].id;
      }
    } catch (err: any) {
      console.error('[Notion] Failed to search for default parent:', err.message);
    }

    return null;
  }
}
