const { randomUUID } = require("node:crypto");

function createEventHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Map();
  const onRemoved = new Set();
  const packet = (channel, payload) => `data: ${JSON.stringify({ channel, payload })}\n\n`;
  function removeClient(id) {
    const client = clients.get(id);
    if (!clients.delete(id)) return;
    client.res.end();
    for (const listener of onRemoved) listener(id);
  }
  function write(id, res, message) {
    if (!res.write(message) && res.writableLength > 256 * 1024) {
      res.destroy();
      removeClient(id);
    }
  }
  const heartbeat = setInterval(() => {
    for (const [id, client] of clients) {
      if (client.valid()) write(id, client.res, ": ping\n\n");
      else removeClient(id);
    }
  }, heartbeatMs);
  heartbeat.unref();
  return {
    addClient(res, { profileId, session, valid = () => true } = {}) {
      const id = randomUUID();
      clients.set(id, { res, profileId, session, valid });
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
    broadcast(channel, payload, { except, to = () => true } = {}) {
      const message = packet(channel, payload);
      for (const [id, client] of clients) {
        if (!client.valid()) removeClient(id);
        else if (id !== except && to(client.profileId)) write(id, client.res, message);
      }
    },
    sendTo(id, channel, payload) {
      const client = clients.get(id);
      if (!client) return;
      if (client.valid()) write(id, client.res, packet(channel, payload));
      else removeClient(id);
    },
    clientMatches(id, profileId) {
      const client = clients.get(id);
      return client?.profileId === profileId && (client?.valid() ?? false);
    },
    disconnectSession(session) {
      if (!session) return;
      for (const [id, client] of clients) if (client.session === session) removeClient(id);
    },
    invalidateProfile(profileId) {
      for (const [id, client] of clients) {
        if (client.profileId !== profileId) continue;
        write(id, client.res, packet("profile-invalidated"));
        removeClient(id);
      }
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

function createWindowStub(hub, { route } = {}) {
  const noop = () => undefined;
  const wrap = (target) => new Proxy(target, { get: (obj, key) => obj[key] ?? noop });
  return wrap({
    isDestroyed: () => false,
    webContents: wrap({
      isDestroyed: () => false,
      send: (channel, payload) => hub.broadcast(channel, payload, { to: route?.(channel, payload) }),
      executeJavaScript: async () => undefined,
    }),
  });
}

module.exports = { createEventHub, createWindowStub };
