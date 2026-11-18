/** Small bounded in-memory controls supplement the durable generation budget. */
export class RateLimit {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly clock = Date.now) {}
  consume(key: string, maximum: number, windowMs = 60000): boolean {
    const now = this.clock();
    if (this.windows.size > 1000) {
      for (const [id, item] of this.windows)
        if (now - item.start >= windowMs) this.windows.delete(id);
      if (this.windows.size > 1000) return false;
    }
    let item = this.windows.get(key);
    if (!item || now - item.start >= windowMs) {
      item = { start: now, count: 0 };
      this.windows.set(key, item);
    }
    return ++item.count <= maximum;
  }
}

/** Zero waiting slots: refuse excess work rather than storing an unbounded promise queue. */
export class TurnAdmission {
  private readonly actors = new Set<string>();
  acquire(actor: string): () => void {
    if (this.actors.has(actor) || this.actors.size >= 2) throw new Error('BUSY');
    this.actors.add(actor);
    return () => {
      this.actors.delete(actor);
    };
  }
}
