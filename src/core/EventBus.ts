/** Listener for a single event type. */
export type EventListener<T> = (payload: T) => void;

/**
 * Minimal type-safe publish/subscribe bus.
 *
 * `Events` maps event names to payload types, e.g. `{ 'player:jumped': { y: number } }`.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<never>>>();

  /** Subscribes to `type`; returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, listener: EventListener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as EventListener<never>);
    return () => this.off(type, listener);
  }

  /** Subscribes to the next emission of `type` only. */
  once<K extends keyof Events>(type: K, listener: EventListener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /** Removes a previously registered listener. */
  off<K extends keyof Events>(type: K, listener: EventListener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener as EventListener<never>);
  }

  /** Synchronously notifies every listener of `type`. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as EventListener<Events[K]>)(payload);
    }
  }

  /** Removes all listeners (of one type, or everything). */
  clear(type?: keyof Events): void {
    if (type === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(type);
    }
  }
}
