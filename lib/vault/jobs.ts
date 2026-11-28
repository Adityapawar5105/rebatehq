// Which job Cancel stops (review flaw 10, 28 Nov 2026). The worker runs one job at a time from one queue: requests
// from the page and its own background work (relay sync, agents, folder pickup, backups, the idle lock). Cancel
// belongs to the page: it stops the page job that is running, or, while a background job runs, the long page jobs
// still waiting. It never interrupts a background job, which it used to do while the import the person meant to
// stop ran to the end. Locking still stops whatever is running.

/** Page jobs that report progress and offer Cancel. */
export const CANCELLABLE = (action: string) =>
  /^(studio(Commit|Plan|Add|Download|Zip)|simRun|reportCheck|agentRun|sharePublish|priceLandedCheck|playgroundLoad|quoteShare|quoteRelaySync|relay[A-Z]\w*)$/.test(action);

export class Jobs {
  private running: { page: boolean; controller: AbortController } | null = null;
  private readonly waiting = new Map<string, string>();
  private readonly cancelled = new Set<string>();

  /** A page request joins the queue; its controller is its own cancellation scope. */
  enqueue(id: string, action: string) {
    this.waiting.set(id, action);
    return new AbortController();
  }

  /** Runs a page job when its turn comes. A job cancelled while it waited never starts. */
  async page<T>(id: string, controller: AbortController, work: () => Promise<T>): Promise<T> {
    this.waiting.delete(id);
    if (this.cancelled.delete(id)) controller.abort();
    if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
    this.running = { page: true, controller };
    try { return await work(); } finally { this.running = null; }
  }

  /** Runs background work, which Cancel leaves alone. */
  async background<T>(work: () => Promise<T>): Promise<T> {
    this.running = { page: false, controller: new AbortController() };
    try { return await work(); } finally { this.running = null; }
  }

  /** Cancel from the page. True when the running page job was aborted, so its database query should be interrupted. */
  cancel(): boolean {
    if (this.running?.page) { this.running.controller.abort(); return true; }
    for (const [id, action] of this.waiting) if (CANCELLABLE(action)) this.cancelled.add(id);
    return false;
  }

  /** Locking stops whatever runs, background work included. */
  lock() { this.running?.controller.abort(); }
}
