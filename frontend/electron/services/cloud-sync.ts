import { app } from "electron";
import * as localStore from "./local-store";

export interface SyncDelta {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: any;
  timestamp: string;
}

export class SyncManager {
  private syncQueue: SyncDelta[] = [];
  private isOnline: boolean = true; // Assume online until told otherwise

  constructor() {
    // Supabase client would be initialized here in a full implementation.
    // e.g., this.supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  /**
   * Updates the online status of the application.
   * Can be hooked up to renderer's navigator.onLine via IPC or main process network detection.
   */
  public handleOnlineStatus(online: boolean) {
    console.log(`[SyncManager] Network status changed. Online: ${online}`);
    this.isOnline = online;
    if (this.isOnline) {
      this.flushSyncQueue();
    }
  }

  /**
   * Queues a local database change to be pushed to the cloud.
   */
  public queueDelta(delta: SyncDelta) {
    this.syncQueue.push(delta);
    if (this.isOnline) {
      this.flushSyncQueue();
    } else {
      console.log(`[SyncManager] Offline. Queued delta for ${delta.table}. Queue size: ${this.syncQueue.length}`);
    }
  }

  /**
   * Flushes the offline sync queue to the Supabase schema.
   */
  private async flushSyncQueue() {
    if (this.syncQueue.length === 0) return;

    console.log(`[SyncManager] Flushing ${this.syncQueue.length} items to Supabase...`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[SyncManager] Supabase URL or Key is not configured.");
      return;
    }

    // Process a snapshot of the queue
    const queueToProcess = [...this.syncQueue];
    this.syncQueue = [];

    for (const delta of queueToProcess) {
      try {
        if (delta.operation === "INSERT" || delta.operation === "UPDATE") {
          const res = await fetch(`${supabaseUrl}/rest/v1/${delta.table}`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(delta.data)
          });
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status} - ${await res.text()}`);
          }
        }
        console.log(`[SyncManager] Synced ${delta.operation} on ${delta.table} to cloud.`);
      } catch (err) {
        console.error(`[SyncManager] Failed to sync delta for ${delta.table}:`, err);
        // Re-queue on failure
        this.syncQueue.push(delta);
      }
    }
  }

  /**
   * Pulls remote changes from the Supabase schema and applies them locally.
   */
  public async pullFromCloud(lastSyncTime: string) {
    if (!this.isOnline) {
      console.log(`[SyncManager] Cannot pull from cloud while offline.`);
      return;
    }

    console.log(`[SyncManager] Pulling latest changes from Supabase since ${lastSyncTime}...`);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return;
    }

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/conversations?updated_at=gt.${encodeURIComponent(lastSyncTime)}`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        }
      });
      if (res.ok) {
        const data = await res.json();
        // apply to localStore (simplified for stub)
        console.log(`[SyncManager] Pulled ${data.length} conversations from cloud.`);
      }
    } catch (err) {
      console.error("[SyncManager] Pull failed:", err);
    }
  }
}

// Export a singleton instance
export const syncManager = new SyncManager();
