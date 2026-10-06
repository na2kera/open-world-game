/** Serializable player state for a future multiplayer session. */
export interface PlayerSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly anim: string;
  readonly hp: number;
  readonly maxHp: number;
}

export interface NetMessage {
  readonly type: string;
  readonly payload: unknown;
}

/** Transport seam. The single-player build uses {@link LocalTransport}. */
export interface NetTransport {
  connect(url: string): Promise<void>;
  disconnect(): void;
  send(message: NetMessage): void;
  onMessage(handler: (message: NetMessage) => void): () => void;
}

/** Loopback transport. Sends are delivered to local subscribers only. */
export class LocalTransport implements NetTransport {
  private readonly handlers = new Set<(message: NetMessage) => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {
    this.handlers.clear();
  }

  send(message: NetMessage): void {
    for (const handler of this.handlers) handler(message);
  }

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
