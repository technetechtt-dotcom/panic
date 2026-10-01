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
    if (!this.config.redisUrl) return;
    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };
    const pub = new Redis(this.config.redisUrl, options);
    const sub = pub.duplicate();
    pub.on("error", () => undefined);
    sub.on("error", () => undefined);
    void Promise.all([pub.connect(), sub.connect()])
      .then(() => {
        server.adapter(createAdapter(pub, sub));
      })
      .catch(() => {
        pub.disconnect();
        sub.disconnect();
        console.error(JSON.stringify({ level: "error", message: "Redis WebSocket adapter unavailable" }));
      });
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
      await client.join("monitors");
      client.emit("auth.ok", { role: user.role });
    } catch {
      client.emit("auth.error", { code: "UNAUTHENTICATED" });
      client.disconnect();
    }
  }
}
