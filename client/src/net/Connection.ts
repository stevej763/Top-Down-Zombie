import { ensureRegistered } from './api';
import type { ClientMessage, ServerMessage } from './protocol';

export type LinkStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

/** What `Game` needs from the socket; the headless smoke run swaps in a fake. */
export interface Link {
  readonly status: LinkStatus;
  /** Smoothed round trip in ms (0 until the first pong). */
  readonly rtt: number;
  /** Counts successful opens, so a reconnect can be noticed. */
  readonly opens: number;
  /** Why the last attempt failed, for the menus; '' when connected. */
  readonly problem: string;
  /** Open the socket if it isn't already; it then stays up, reconnecting, until `close()`. */
  connect(): void;
  send(msg: ClientMessage): void;
  /** Messages received since the last call, oldest first. */
  drain(): ServerMessage[];
  close(): void;
}

const PING_EVERY_MS = 2000;
const BACKOFF_MIN_MS = 250;
const BACKOFF_MAX_MS = 5000;

/**
 * The /ws socket: JSON in and out, a ping every 2 s for the RTT, and reconnects with backoff
 * (the server resumes the player's room within its 30 s grace). Messages are queued in an inbox
 * and drained by the game loop, so they're handled between ticks rather than mid-frame.
 */
export class Connection implements Link {
  status: LinkStatus = 'idle';
  rtt = 0;
  opens = 0;
  problem = '';
  private ws: WebSocket | null = null;
  private inbox: ServerMessage[] = [];
  /** Lobby commands sent while connecting; inputs and pings aren't worth replaying. */
  private outbox: ClientMessage[] = [];
  private wanted = false;
  private attempts = 0;
  /** The last attempt never opened, which could be a token the server no longer knows. */
  private verify = false;
  private pingTimer = 0;
  private retryTimer = 0;
  /** Bumped by every attempt and by `close()`, so a stale attempt that resolves late gives up. */
  private generation = 0;

  connect(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.attempts = 0;
    void this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.status === 'open') this.ws.send(JSON.stringify(msg));
    else if (msg.type !== 'input' && msg.type !== 'ping') this.outbox.push(msg);
  }

  drain(): ServerMessage[] {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  close(): void {
    this.wanted = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.status = 'idle';
    this.inbox = [];
    this.outbox = [];
    this.problem = '';
  }

  private async open(): Promise<void> {
    this.status = this.opens > 0 ? 'reconnecting' : 'connecting';
    const generation = ++this.generation;
    const id = await ensureRegistered(this.verify);
    if (!this.wanted || generation !== this.generation) return;
    if (!id?.token) {
      this.problem = id ? "Can't reach the server" : 'Pick a name first';
      this.retry();
      return;
    }
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}${import.meta.env.BASE_URL}ws?token=${encodeURIComponent(id.token)}`);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      opened = true;
      this.status = 'open';
      this.problem = '';
      this.attempts = 0;
      this.verify = false;
      this.opens++;
      for (const m of this.outbox) ws.send(JSON.stringify(m));
      this.outbox = [];
      this.ping();
      this.pingTimer = window.setInterval(() => this.ping(), PING_EVERY_MS);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        const sample = performance.now() - msg.t;
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
      } else {
        this.inbox.push(msg);
      }
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      if (!this.wanted) return;
      if (!opened) {
        this.verify = true;
        this.problem = "Can't reach the server";
      }
      this.retry();
    };
  }

  private retry(): void {
    this.status = this.opens > 0 ? 'reconnecting' : 'connecting';
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempts++);
    this.retryTimer = window.setTimeout(() => {
      if (this.wanted) void this.open();
    }, delay);
  }

  private ping(): void {
    this.send({ type: 'ping', t: performance.now() });
  }
}
