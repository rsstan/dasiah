// The client's logger: one place for what the application reports about itself. Every entry has
// a level, a message and context (e.g. the correlation id of a failed request, which matches the
// server logs). Development shows everything; a production build shows warnings and errors only.
// The latest entries are kept in memory for diagnostics and tests.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface LogEntry {
  level: LogLevel;
  message: string;
  context: LogContext;
  at: string;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const KEEP = 50;

export class Logger {
  private readonly entries: LogEntry[] = [];
  private readonly min: LogLevel;

  constructor(min: LogLevel) {
    this.min = min;
  }

  debug(message: string, context: LogContext = {}): void {
    this.write('debug', message, context);
  }
  info(message: string, context: LogContext = {}): void {
    this.write('info', message, context);
  }
  warn(message: string, context: LogContext = {}): void {
    this.write('warn', message, context);
  }
  error(message: string, context: LogContext = {}): void {
    this.write('error', message, context);
  }

  /** The latest entries, oldest first. */
  recent(): readonly LogEntry[] {
    return this.entries;
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    const entry = { level, message, context, at: new Date().toISOString() };
    this.entries.push(entry);
    if (this.entries.length > KEEP) {
      this.entries.shift();
    }
    if (RANK[level] >= RANK[this.min]) {
      console[level](`[heatmap] ${message}`, context);
    }
  }
}

export const logger = new Logger(import.meta.env.DEV ? 'debug' : 'warn');
