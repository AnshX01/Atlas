import { app, BrowserWindow } from "electron";
import * as localStore from "./local-store";
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type SyncState = "synced" | "syncing" | "offline" | "conflict";

export interface SyncDelta {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: any;
  timestamp: string;
}

export class SyncManager {
  private supabase: SupabaseClient | null = null;
  private isOnline: boolean = true;
  private currentState: SyncState = "synced";

  public getState(): SyncState {
    return this.currentState;
  }

  private setState(state: SyncState) {
    if (this.currentState !== state) {
      this.currentState = state;
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("sync-state-change", state);
        }
      });
    }
  }

  constructor() {
    // NOTE: In Electron main process, process.env does NOT contain Next.js
    // NEXT_PUBLIC_* variables — those are injected at Next.js build time for
    // the renderer. We must read them from the bundled config module.
    let supabaseUrl: string | undefined;
    let supabaseKey: string | undefined;
    try {
      // Try to import from the Electron config module (main process path)
      const config = require("./config");
      supabaseUrl = config.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      supabaseKey = config.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } catch {
      // Fallback: direct process.env (works in renderer/test environments)
      supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    } else {
      console.warn("[SyncManager] Supabase not configured: SUPABASE_URL or SUPABASE_ANON_KEY is missing.");
    }
  }

  public handleOnlineStatus(online: boolean) {
    console.log(`[SyncManager] Network status changed. Online: ${online}`);
    this.isOnline = online;
    if (this.isOnline) {
      this.flushSyncQueue();
    } else {
      this.setState("offline");
    }
  }

  public queueDelta(delta: SyncDelta) {
    // Queue to SQLite store for persistent offline queue
    localStore.enqueueSync(delta.table, delta.operation, delta.data, delta.timestamp);
    if (this.isOnline) {
      this.flushSyncQueue();
    } else {
      this.setState("offline");
      console.log(`[SyncManager] Offline. Queued delta for ${delta.table}.`);
    }
  }

  private hasWarnedSupabase = false;
  private isFlushing = false;

  private async flushSyncQueue() {
    if (!this.isOnline || this.isFlushing) return;

    const queueToProcess = localStore.getSyncQueue();
    if (queueToProcess.length === 0) {
      if (this.currentState !== "synced") this.setState("synced");
      return;
    }

    if (!this.supabase) {
      if (!this.hasWarnedSupabase) {
        console.warn("[SyncManager] Supabase URL or Key is not configured. Local changes will not be synced.");
        this.hasWarnedSupabase = true;
      }
      return;
    }

    this.isFlushing = true;
    this.setState("syncing");
    console.log(`[SyncManager] Flushing ${queueToProcess.length} items to Supabase...`);

    let hasConflict = false;
    let transientError = false;

    try {
      for (const item of queueToProcess) {
        try {
          if (item.operation === "INSERT" || item.operation === "UPDATE") {
            const { error } = await this.supabase
              .from(item.table_name)
              .upsert(item.data, { onConflict: 'id', ignoreDuplicates: false });
            
            if (error) {
              if (error.code === '23505' || error.code === '23503' || (error.message && error.message.includes('conflict'))) {
                hasConflict = true;
              } else {
                transientError = true;
              }
              throw error;
            }
          } else if (item.operation === "DELETE") {
            const { error } = await this.supabase
              .from(item.table_name)
              .delete()
              .eq('id', item.data.id);
              
            if (error) {
              if (error.code === '23505' || error.code === '23503' || (error.message && error.message.includes('conflict'))) {
                hasConflict = true;
              } else {
                transientError = true;
              }
              throw error;
            }
          }
          
          // Remove from local sync queue on success
          localStore.removeSyncItem(item.id);
          console.log(`[SyncManager] Synced ${item.operation} on ${item.table_name} to cloud.`);
        } catch (err) {
          console.error(`[SyncManager] Failed to sync delta for ${item.table_name}:`, err);
          if (transientError) break;
        }
      }
    } finally {
      // Always reset isFlushing — even if an unexpected error escapes the inner catch
      this.isFlushing = false;
    }
    
    // Check if there are more items that were added while flushing
    const remainingQueue = localStore.getSyncQueue();
    
    if (hasConflict) {
      this.setState("conflict");
    } else if (transientError) {
      this.setState("offline");
    } else if (remainingQueue.length === 0) {
      this.setState("synced");
    } else {
      // recursively flush if more items arrived
      this.flushSyncQueue();
    }
  }

  public async pullFromCloud(lastSyncTime: string, currentUserId?: string) {
    if (!this.isOnline || !this.supabase) {
      console.log(`[SyncManager] Cannot pull from cloud while offline or unconfigured.`);
      return;
    }

    console.log(`[SyncManager] Pulling latest changes from Supabase since ${lastSyncTime}...`);
    
    const timeoutMs = 10000;
    let resolveTimeout: (val: any) => void;
    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
      resolveTimeout = resolve;
    });

    const timeoutId = setTimeout(() => {
      resolveTimeout({ data: null, error: new Error("pullFromCloud timeout") });
    }, timeoutMs);
    
    try {
      const queryPromise = this.supabase
        .from('conversations')
        .select('*')
        .gt('updated_at', lastSyncTime);
        
      const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as any;
        
      if (error) throw error;
      
      if (data && data.length > 0) {
        let written = 0;
        let skipped = 0;
        data.forEach(conv => {
          // Ownership validation: only write rows that belong to the current user.
          // This guards against Supabase RLS misconfiguration where foreign rows
          // could overwrite local state.
          if (currentUserId && conv.user_id && conv.user_id !== currentUserId) {
            console.warn(`[SyncManager] Skipping foreign conversation row (id=${conv.id}, owner=${conv.user_id})`);
            skipped++;
            return;
          }
           localStore.updateLocalRecord('conversations', conv);
          written++;
        });
        console.log(`[SyncManager] Pulled ${written} conversations from cloud (${skipped} foreign rows skipped).`);
      }
    } catch (err) {
      console.error("[SyncManager] Pull failed:", err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async pullSecret(hashedEmailId: string, secretKey: string): Promise<string | null> {
    if (!this.isOnline || !this.supabase) return null;

    // 5-second timeout guard: a hung Supabase response must not block app startup.
    const timeoutMs = 5000;
    let resolveTimeout: (val: any) => void;
    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
      resolveTimeout = resolve;
    });

    const timeoutId = setTimeout(() => {
      console.warn("[SyncManager] pullSecret timed out after 5s.");
      resolveTimeout({ data: null, error: new Error("pullSecret timeout") });
    }, timeoutMs);

    try {
      // Supabase JS v2 does not directly support AbortSignal on queries,
      // so we race the query against a manual timeout promise.
      const queryPromise = this.supabase
        .from('user_secrets')
        .select('encrypted_value')
        .eq('user_id', hashedEmailId)
        .eq('secret_key', secretKey)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
        
      if (error) throw error;
      return data ? (data as any).encrypted_value : null;
    } catch (err) {
      console.error("[SyncManager] Failed to pull secret:", err);
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }
}

// Export a singleton instance
export const syncManager = new SyncManager();
