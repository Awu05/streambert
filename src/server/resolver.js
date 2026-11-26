// Finds streams with at most `maxPages` hidden pages open; extra requests queue.
// Results are cached per provider URL for `cacheMs`.
function createResolver({ maxPages, openPage, timeoutMs = 25000, cacheMs = 600000 }) {
  const queue = [];
  const running = new Set();
  const resolved = new Map();
  const notify = () => queue.forEach((job, index) => job.onQueue?.(index + 1));

  async function run(job) {
    const { signal } = job.controller;
    const timeout = setTimeout(() => job.controller.abort(new Error("Timed out finding the stream")), timeoutMs);
    try {
      if (signal.aborted) throw signal.reason;
      const aborted = new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      const media = await Promise.race([openPage(job.input, signal), aborted]);
      resolved.set(job.input.url, { media, expires: Date.now() + cacheMs });
      job.resolve(media);
    } finally {
      clearTimeout(timeout);
    }
  }

  function drain() {
    while (running.size < maxPages && queue.length) {
      const job = queue.shift();
      job.onQueue?.(null);
      const cached = resolved.get(job.input.url);
      if (cached?.expires > Date.now()) {
        job.resolve(cached.media);
        continue;
      }
      running.add(job);
      run(job).catch(job.reject).finally(() => {
        running.delete(job);
        drain();
      });
    }
    notify();
  }

  // A request's id is "<client>:<request>", so a client id cancels all its requests.
  function cancel(id) {
    if (!id) return;
    const matches = (job) => job.clientId === id || job.clientId?.startsWith(id + ":");
    for (let index = queue.length - 1; index >= 0; index--) {
      if (matches(queue[index])) queue.splice(index, 1)[0].reject(new Error("Cancelled"));
    }
    for (const job of running) if (matches(job)) job.controller.abort(new Error("Cancelled"));
    notify();
  }

  return {
    resolve(input, { clientId, onQueue } = {}) {
      return new Promise((resolve, reject) => {
        queue.push({ input, clientId, onQueue, resolve, reject, controller: new AbortController() });
        drain();
      });
    },
    cancel,
    sweep() {
      for (const [url, item] of resolved) if (item.expires <= Date.now()) resolved.delete(url);
    },
    close() {
      for (const job of queue.splice(0)) job.reject(new Error("Server closed"));
      for (const job of running) job.controller.abort(new Error("Server closed"));
      resolved.clear();
    },
  };
}

module.exports = { createResolver };
