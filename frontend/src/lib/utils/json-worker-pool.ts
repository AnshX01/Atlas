export class JsonWorkerPool {
  static worker: Worker | null = null;
  static id = 0;
  static callbacks = new Map<number, { resolve: Function; reject: Function }>();

  static init() {
    if (typeof window === 'undefined' || typeof Worker === 'undefined' || this.worker) return;
    try {
      this.worker = new Worker(new URL('../workers/json.worker.ts', import.meta.url));
      this.worker.onmessage = (e) => {
        const { id, result, error, success } = e.data;
        const cb = this.callbacks.get(id);
        if (cb) {
          this.callbacks.delete(id);
          if (success) cb.resolve(result);
          else cb.reject(new Error(error));
        }
      };
      this.worker.onerror = (e) => {
        console.warn("[JsonWorkerPool] Worker error, falling back to main thread:", e);
      };
    } catch (err) {
      console.warn("[JsonWorkerPool] Could not initialize Web Worker:", err);
      this.worker = null;
    }
  }

  static fallbackParse(data: string, action: 'parse' | 'parseArray' = 'parse'): any {
    if (action === 'parse') {
      return JSON.parse(data);
    }
    let cleaned = data.trim();
    if (cleaned.startsWith('`')) {
      cleaned = cleaned.replace(/^`(?:json)?\s*\n?/, '').replace(/\n?`\s*$/, '');
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    return JSON.parse(arrayMatch[0]);
  }

  static parse(data: string, action: 'parse' | 'parseArray' = 'parse'): Promise<any> {
    this.init();
    if (!this.worker) {
      try {
        return Promise.resolve(this.fallbackParse(data, action));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return new Promise((resolve, reject) => {
      const currentId = this.id++;
      const timeoutId = setTimeout(() => {
        this.callbacks.delete(currentId);
        try {
          resolve(this.fallbackParse(data, action));
        } catch (err) {
          reject(err);
        }
      }, 2000);

      this.callbacks.set(currentId, {
        resolve: (val: any) => {
          clearTimeout(timeoutId);
          resolve(val);
        },
        reject: (err: any) => {
          clearTimeout(timeoutId);
          try {
            resolve(this.fallbackParse(data, action));
          } catch (fallbackErr) {
            reject(err);
          }
        },
      });

      try {
        this.worker!.postMessage({ id: currentId, data, action });
      } catch (postErr) {
        clearTimeout(timeoutId);
        this.callbacks.delete(currentId);
        try {
          resolve(this.fallbackParse(data, action));
        } catch (err) {
          reject(postErr);
        }
      }
    });
  }
}
