
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
  }

  getPlayers() {
    return this.state.getWebSockets().map(ws => {
      try {
        return ws.deserializeAttachment();
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Ignore disconnected sockets.
    }
  }

  broadcast() {
    const players = this.getPlayers();

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
        players
      });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      return json({ success: true });
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", {
        status: 426
      });
    }

    if (this.getPlayers().length >= MAX_PLAYERS) {
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
      alive: true
    });

    this.state.acceptWebSocket(server);

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
        if (!this.started || !player.alive) break;

        const dx = Number(data.dx) || 0;
        const dz = Number(data.dz) || 0;

        player.x = Math.max(-2, Math.min(2, Number(data.x) || 0));

        if (dz > 0) {
          player.row = Math.min(
            100000,
            player.row + Math.min(1, Math.floor(dz))
          );
        }

        if (dx !== 0) {
          player.x = Math.max(-2, Math.min(2, player.x));
        }

        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "position": {
        if (!player.alive) break;

        player.x = Math.max(-2, Math.min(2, Number(data.x) || 0));
        ws.serializeAttachment(player);
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
        player.alive = false;
        ws.serializeAttachment(player);
        this.broadcast();
        break;
      }

      case "start": {
        if (!this.started) {
          this.started = true;
          this.startAt = Date.now() + 1500;
        }

        this.broadcast();
        break;
      }

      case "reset": {
        this.started = false;
        this.startAt = 0;
        this.resetVersion++;
        this.roomSeed = Math.floor(Math.random() * 2147483647);

        for (const socket of this.state.getWebSockets()) {
          const current = socket.deserializeAttachment();
          if (!current) continue;

          current.x = 0;
          current.row = 0;
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

    this.broadcast();
  }

  webSocketError(ws) {
    try {
      ws.close();
    } catch {
      // Ignore socket errors.
    }

    this.broadcast();
  }
}
