import { Inject } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, Socket } from "socket.io";
import type { AppConfig } from "../../config";
import { ACCESS_TOKENS, APP_CONFIG, USER_STORE } from "../../common/tokens";
import type { AccessTokenIssuer } from "../../domain/auth-service";
import type { RealtimePublisher, UserStore } from "../../domain/ports";
import { hasPermission, Permission } from "../../domain/rbac";
import { setWebsocketStatus } from "./realtime-status";

@WebSocketGateway({
  namespace: "/monitoring",
  cors: { origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","), credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, RealtimePublisher {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokenIssuer,
    @Inject(USER_STORE) private readonly users: UserStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(server: Server): void {
    if (!this.config.redisUrl) {
      setWebsocketStatus("single-process");
      return;
    }
    setWebsocketStatus("redis adapter connecting");
    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (attempt: number) => (attempt > 20 ? null : Math.min(attempt * 200, 2000)),
    };
    const pub = new Redis(this.config.redisUrl, options);
    const sub = pub.duplicate();
    pub.on("error", () => undefined);
    sub.on("error", () => undefined);
    const connect = async (): Promise<void> => {
      try {
        if (pub.status === "wait" || pub.status === "end") await pub.connect();
        if (sub.status === "wait" || sub.status === "end") await sub.connect();
        const pong = await pub.ping();
        if (pong !== "PONG") throw new Error("Redis did not answer PING.");
        const io = typeof (server as { adapter?: unknown }).adapter === "function"
          ? server
          : (server as unknown as { server: Server }).server;
        io.adapter(createAdapter(pub, sub));
        setWebsocketStatus("redis adapter up");
      } catch {
        pub.disconnect();
        sub.disconnect();
        setWebsocketStatus("redis adapter down");
        console.error(JSON.stringify({ level: "error", message: "Redis WebSocket adapter unavailable" }));
      }
    };
    void connect();
  }

  publish(name: string, payload: unknown): void {
    this.server?.to("monitors").emit(name, payload);
  }

  @SubscribeMessage("auth")
  async authenticate(@MessageBody() body: unknown, @ConnectedSocket() client: Socket): Promise<void> {
    const token = body && typeof body === "object" && "token" in body ? (body as { token?: unknown }).token : undefined;
    if (typeof token !== "string") {
      client.emit("auth.error", { code: "UNAUTHENTICATED" });
      client.disconnect();
      return;
    }
    try {
      const claims = await this.tokens.verify(token);
      const user = await this.users.findById(claims.sub);
      if (!user || !hasPermission(user.role, Permission.IncidentReadActive)) {
        client.emit("auth.error", { code: "FORBIDDEN" });
        client.disconnect();
        return;
      }
      client.data.userId = user.id;
      await client.join("monitors");
      client.emit("auth.ok", { role: user.role });
    } catch {
      client.emit("auth.error", { code: "UNAUTHENTICATED" });
      client.disconnect();
    }
  }

  async dropRevokedOperators(): Promise<number> {
    const sockets = await this.server?.fetchSockets?.();
    if (!sockets) return 0;
    let dropped = 0;
    for (const socket of sockets) {
      const userId = typeof socket.data.userId === "string" ? socket.data.userId : "";
      if (!userId) continue;
      const user = await this.users.findById(userId);
      if (!user || !hasPermission(user.role, Permission.IncidentReadActive)) {
        socket.disconnect(true);
        dropped += 1;
      }
    }
    return dropped;
  }
}
