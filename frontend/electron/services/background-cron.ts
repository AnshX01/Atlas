import { Notification } from 'electron';
import { MCPServerManager } from './mcp-manager';

export class CronEngine {
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;
  private notifiedIds = new Set<string>();

  constructor(private mcpManager: MCPServerManager) {}

  start() {
    if (this.timer) return;
    
    // Run every 5 minutes (300,000 ms)
    this.timer = setInterval(async () => {
      await this.checkImportantItems();
    }, 5 * 60 * 1000);
    
    // Also run immediately upon start
    this.checkImportantItems().catch(console.error);
  }
  
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  
  private async checkImportantItems() {
    if (!this.mcpManager || this.isChecking) return;
    this.isChecking = true;
    
    try {
      // 1. Check Emails
      const emailResult = await this.mcpManager.callTool('google_workspace', 'list_emails', { 
        maxResults: 5, 
        query: 'is:unread is:important', 
        skipCache: true 
      });
      
      if (Array.isArray(emailResult)) {
        const newEmails = emailResult.filter(e => e.id && !this.notifiedIds.has(e.id));
        newEmails.forEach(e => this.notifiedIds.add(e.id));
        for (const email of newEmails) {
          const subject = email.subject || '';
          const from = email.from || '';
          // Identify urgent items based on heuristic
          if (subject.toLowerCase().includes('urgent') || from.toLowerCase().includes('sarah')) {
             try {
               new Notification({
                  title: `Urgent email from ${from.split('<')[0].trim()}`,
                  body: subject
               }).show();
             } catch (e) {
               console.warn("Failed to show notification", e);
             }
          }
        }
      }
      
      // 2. Check Calendar for upcoming events in the next hour
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 60 * 60 * 1000).toISOString(); 
      const calResult = await this.mcpManager.callTool('google_workspace', 'list_events', {
         timeMin,
         timeMax
      });
      
      if (Array.isArray(calResult) && calResult.length > 0) {
        const now = Date.now();
        for (const event of calResult) {
          if (!event.start) continue;
          const startTime = new Date(event.start).getTime();
          const timeUntil = startTime - now;
          // Notify if an event is starting in the next 15 minutes
          if (timeUntil > 0 && timeUntil <= 15 * 60 * 1000) {
            const eventId = event.id || event.title;
            if (eventId && !this.notifiedIds.has(eventId)) {
              this.notifiedIds.add(eventId);
              try {
                new Notification({
                  title: 'Upcoming Meeting',
                  body: `${event.title} starts in ${Math.ceil(timeUntil / 60000)} minutes.`
                }).show();
              } catch (e) {
                console.warn("Failed to show notification", e);
              }
            }
          }
        }
      }
      
    } catch (err) {
      console.error('[CronEngine] Error checking important items:', err);
    } finally {
      this.isChecking = false;
    }
  }
}
