/**
 * Type declarations for better-sqlite3.
 * Minimal typing for Atlas usage — full types available via @types/better-sqlite3.
 */

declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface ColumnDefinition {
    name: string;
    column: string | null;
    table: string | null;
    database: string | null;
    type: string | null;
  }

  interface Statement {
    run(...params: any[]): RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
    iterate(...params: any[]): IterableIterator<any>;
    pluck(toggleState?: boolean): this;
    expand(toggleState?: boolean): this;
    raw(toggleState?: boolean): this;
    columns(): ColumnDefinition[];
    bind(...params: any[]): this;
  }

  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: any, ...additionalArgs: any[]) => void;
    nativeBinding?: string;
  }

  interface Database {
    prepare(source: string): Statement;
    exec(source: string): this;
    pragma(source: string, options?: { simple?: boolean }): any;
    transaction<F extends (...args: any[]) => any>(fn: F): F;
    close(): this;
    readonly open: boolean;
    readonly inTransaction: boolean;
    readonly name: string;
    readonly memory: boolean;
    readonly readonly: boolean;
  }

  interface DatabaseConstructor {
    new (filename: string | Buffer, options?: Options): Database;
    (filename: string | Buffer, options?: Options): Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
