const { randomUUID } = require("node:crypto");

function createEventHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Map();
  const onRemoved = new Set();
  const packet = (channel, payload) => `data: ${JSON.stringify({ channel, payload })}\n\n`;
  function removeClient(id) {
    const res = clients.get(id);
    if (!clients.delete(id)) return;
    res.end();
    for (const listener of onRemoved) listener(id);
  }
  function write(id, res, message) {
    if (!res.write(message) && res.writableLength > 256 * 1024) {
      res.destroy();
      removeClient(id);
    }
  }
  const heartbeat = setInterval(() => {
    for (const [id, res] of clients) write(id, res, ": ping\n\n");
  }, heartbeatMs);
  heartbeat.unref();
  return {
    addClient(res) {
      const id = randomUUID();
      clients.set(id, res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.on("close", () => removeClient(id));
      write(id, res, packet("hello", { clientId: id }));
      return id;
    },
    removeClient,
    onClientRemoved(listener) {
      onRemoved.add(listener);
    },
    broadcast(channel, payload, { except } = {}) {
      const message = packet(channel, payload);
      for (const [id, res] of clients) if (id !== except) write(id, res, message);
    },
    sendTo(id, channel, payload) {
      const res = clients.get(id);
      if (res) write(id, res, packet(channel, payload));
    },
    clientFor(id) {
      return { send: (channel, payload) => this.sendTo(id, channel, payload) };
    },
    close() {
      clearInterval(heartbeat);
      for (const id of clients.keys()) removeClient(id);
    },
  };
}

function createWindowStub(hub) {
  const noop = () => undefined;
  const wrap = (target) => new Proxy(target, { get: (obj, key) => obj[key] ?? noop });
  return wrap({
    isDestroyed: () => false,
    webContents: wrap({
      isDestroyed: () => false,
      send: (channel, payload) => hub.broadcast(channel, payload),
      executeJavaScript: async () => undefined,
    }),
  });
}

module.exports = { createEventHub, createWindowStub };
