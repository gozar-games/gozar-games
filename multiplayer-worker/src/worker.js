const MAX_PLAYERS = 4;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomSeed = Math.floor(Math.random() * 2147483647);
    this.started = false;
    this.startAt = 0;
    this.resetVersion = 0;
    this.finished = false;
    this.finalResults = [];
    this.bots = [];
    this.botCount = 0;
    this.hostId = null;
  }

  getRealPlayers() {
    return this.state.getWebSockets().map(ws => {
      try {
        return ws.deserializeAttachment();
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  getPlayers() {
    return [...this.getRealPlayers(), ...this.bots];
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Ignore disconnected sockets.
    }
  }

  updateFinalResults(players) {
    if (
      this.started &&
      players.length > 0 &&
      players.every(player => player.alive === false)
    ) {
      if (!this.finished) {
        this.finished = true;

        this.finalResults = players
          .map(player => ({
            id: player.id,
            name: player.name,
            skin: player.skin,
            row: Math.max(0, Number(player.row) || 0),
            distance: Math.max(0, Number(player.row) || 0),
            finishedAt: player.finishedAt || Date.now()
          }))
          .sort((a, b) => {
            if (b.distance !== a.distance) {
              return b.distance - a.distance;
            }

            return a.finishedAt - b.finishedAt;
          })
          .map((player, index) => ({
            ...player,
            rank: index + 1
          }));
      }
    }
  }

  broadcast() {
    const players = this.getPlayers();

    this.updateFinalResults(players);

    for (const ws of this.state.getWebSockets()) {
      let player;

      try {
        player = ws.deserializeAttachment();
      } catch {
        continue;
      }

      if (!player) continue;

      this.send(ws, {
        type: "state",
        playerId: player.id,
        seed: this.roomSeed,
        started: this.started,
        startAt: this.startAt,
        resetVersion: this.resetVersion,
        finished: this.finished,
        results: this.finalResults,
        hostId: this.hostId,
        players
      });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      await this.state.storage.put("roomInitialized", true);
      return json({ success: true });
    }

    if (url.pathname === "/exists" && request.method === "GET") {
      const initialized = await this.state.storage.get("roomInitialized");
      return json({ exists: initialized === true });
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    const initialized = await this.state.storage.get("roomInitialized");
    if (initialized !== true) {
      return json({ error: "Room not found" }, 404);
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", {
        status: 426
      });
    }

    if (this.getRealPlayers().length >= MAX_PLAYERS) {
      return json({ error: "Room is full" }, 409);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const id = crypto.randomUUID();

    const name = (url.searchParams.get("name") || "Player")
      .trim()
      .slice(0, 16) || "Player";

    const skin = (url.searchParams.get("skin") || "chicken")
      .slice(0, 24);

    server.serializeAttachment({
      id,
      name,
      skin,
      x: 0,
      row: 0,
      distance: 0,
      finishedAt: null,
      alive: true
    });

    this.state.acceptWebSocket(server);
    if (!this.hostId) this.hostId = id;

    this.send(server, {
      type: "connected",
      playerId: id
    });

    this.broadcast();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      this.send(ws, {
        type: "error",
        message: "Invalid message"
      });
      return;
    }

    const player = ws.deserializeAttachment();
    if (!player) return;

    switch (data.type) {
      case "move": {
        if (!this.started || this.finished || !player.alive) break;

        const dx = Number(data.dx) || 0;
        const dz = Number(data.dz) || 0;

        player.x = Math.max(-2, Math.min(2, Number(data.x) || 0));

        if (dz > 0) {
          player.row = Math.min(
            100000,
            player.row + Math.min(1, Math.floor(dz))
          );
        }

        player.distance = Math.max(0, Number(player.row) || 0);

        if (dx !== 0) {
          player.x = Math.max(-2, Math.min(2, player.x));
        }

        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "position": {
        if (!player.alive || this.finished) break;

        player.x = Math.max(-2, Math.min(2, Number(data.x) || 0));
        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "bots": {
        if (player.id !== this.hostId || !this.started || this.finished) break;
        const incoming = Array.isArray(data.players) ? data.players : [];
        this.bots = incoming.slice(0, this.botCount).map((bot, index) => ({
          id: `ai-${index + 1}`,
          name: `هوش مصنوعی ${index + 1}`,
          skin: String(bot.skin || "chicken").slice(0, 24),
          x: Math.max(-2.5, Math.min(2.5, Number(bot.x) || 0)),
          row: Math.max(0, Math.min(100000, Math.floor(Number(bot.row) || 0))),
          distance: Math.max(0, Math.floor(Number(bot.row) || 0)),
          alive: bot.alive !== false,
          finishedAt: bot.alive === false ? (Number(bot.finishedAt) || Date.now()) : null,
          isAI: true
        }));
        this.broadcast();
        break;
      }

      case "skin": {
        player.skin = String(data.skin || "chicken").slice(0, 24);
        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "dead": {
        if (!player.alive) break;

        player.alive = false;
        player.distance = Math.max(0, Number(player.row) || 0);
        player.finishedAt = Date.now();

        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "start": {
        if (player.id !== this.hostId) {
          this.send(ws, { type: "error", message: "فقط میزبان می‌تواند مسابقه را شروع کند." });
          break;
        }

        if (!this.started && !this.finished) {
          this.started = true;
          this.startAt = Date.now() + 1500;
          const realPlayers = this.getRealPlayers();
          this.botCount = realPlayers.length < MAX_PLAYERS ? 1 : 0;
          this.bots = Array.from({ length: this.botCount }, (_, index) => ({
            id: `ai-${index + 1}`,
            name: `هوش مصنوعی ${index + 1}`,
            skin: index === 0 ? "suit" : "spider",
            x: index === 0 ? -1 : 1,
            row: 0,
            distance: 0,
            alive: true,
            finishedAt: null,
            isAI: true
          }));
        }

        this.broadcast();
        break;
      }

      case "reset": {
        if (player.id !== this.hostId) {
          this.send(ws, { type: "error", message: "فقط میزبان می‌تواند مسابقه را ریست کند." });
          break;
        }

        this.started = false;
        this.startAt = 0;
        this.finished = false;
        this.finalResults = [];
        this.bots = [];
        this.botCount = 0;

        this.resetVersion++;
        this.roomSeed = Math.floor(Math.random() * 2147483647);

        for (const socket of this.state.getWebSockets()) {
          const current = socket.deserializeAttachment();
          if (!current) continue;

          current.x = 0;
          current.row = 0;
          current.distance = 0;
          current.finishedAt = null;
          current.alive = true;

          socket.serializeAttachment(current);
        }

        this.broadcast();
        break;
      }
    }
  }

  webSocketClose(ws) {
    try {
      ws.close();
    } catch {
      // Ignore already closed sockets.
    }

    if (this.hostId) {
      const remaining = this.getRealPlayers();
      if (!remaining.some(player => player.id === this.hostId)) this.hostId = remaining[0]?.id || null;
    }
    this.broadcast();
  }

  webSocketError(ws) {
    try {
      ws.close();
    } catch {
      // Ignore socket errors.
    }

    if (this.hostId) {
      const remaining = this.getRealPlayers();
      if (!remaining.some(player => player.id === this.hostId)) this.hostId = remaining[0]?.id || null;
    }
    this.broadcast();
  }
}
