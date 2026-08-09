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

    // Process a snapshot of the queue
    const queueToProcess = [...this.syncQueue];
    this.syncQueue = [];

    for (const delta of queueToProcess) {
      try {
        // In a real implementation:
        // await this.supabase.from(delta.table).upsert(delta.data);
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
    // In a real implementation:
    // const { data } = await this.supabase.from('conversations').select('*').gt('updated_at', lastSyncTime);
    // if (data) { apply to localStore }
  }
}

// Export a singleton instance
export const syncManager = new SyncManager();
