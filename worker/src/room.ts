import { DurableObject } from "cloudflare:workers";
import { hashToken, constantTimeEqual, isParticipantToken } from "./security";
import type { Env, ParticipantRole, RoomRecord, SignalKind, SocketAttachment } from "./types";

const AUTH_TIMEOUT_MS = 5_000;
const HOST_GRACE_MS = 60_000;
const MAX_WEBSOCKET_MESSAGE_BYTES = 32 * 1024;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/u;

interface InternalCreateBody {
  hostTokenHash: string;
  guestTokenHash: string;
  expiresAt: number;
}

interface AuthMessage {
  type: "auth";
  role: ParticipantRole;
  token: string;
}

interface SignalMessage {
  type: "signal";
  kind: SignalKind;
  payload: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRole(value: unknown): value is ParticipantRole {
  return value === "host" || value === "guest";
}

function isSignalKind(value: unknown): value is SignalKind {
  return value === "offer" || value === "answer" || value === "ice";
}

function validSignalPayload(kind: SignalKind, payload: unknown): boolean {
  if (kind === "ice") {
    return (
      payload === null ||
      (isObject(payload) &&
        (payload.candidate === null || payload.candidate === undefined || typeof payload.candidate === "string"))
    );
  }
  return (
    isObject(payload) &&
    payload.type === kind &&
    typeof payload.sdp === "string" &&
    payload.sdp.length > 0
  );
}

function websocketError(code: string, message: string): Record<string, string> {
  return { type: "error", code, message };
}

export class Room extends DurableObject<Env> {
  private storageAvailable = true;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/create") {
      return this.create(request);
    }
    if (request.method === "POST" && url.pathname === "/internal/auth") {
      return this.authorize(request);
    }
    if (request.method === "DELETE" && url.pathname === "/internal/room") {
      return this.deleteRoom(request);
    }
    if (request.method === "GET" && url.pathname === "/ws") {
      return this.upgradeWebSocket(request);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  async webSocketMessage(webSocket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const size =
      typeof rawMessage === "string"
        ? new TextEncoder().encode(rawMessage).byteLength
        : rawMessage.byteLength;
    if (size > MAX_WEBSOCKET_MESSAGE_BYTES) {
      this.send(webSocket, websocketError("payload_too_large", "Mensagem WebSocket excede o limite permitido."));
      this.safeClose(webSocket, 1009, "payload_too_large");
      return;
    }
    if (typeof rawMessage !== "string") {
      this.send(webSocket, websocketError("invalid_message", "Somente mensagens JSON em texto são aceitas."));
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.send(webSocket, websocketError("invalid_json", "Mensagem JSON inválida."));
      return;
    }

    const attachment = this.attachment(webSocket);
    if (!attachment || attachment.cleaned) {
      this.safeClose(webSocket, 4401, "authentication_required");
      return;
    }

    if (!attachment.role) {
      await this.authenticateWebSocket(webSocket, attachment, message);
      return;
    }

    const room = this.room();
    if (!room || room.expires_at <= Date.now()) {
      await this.closeRoom("room_expired", 4001);
      return;
    }

    if (!this.isSignalMessage(message)) {
      this.send(webSocket, websocketError("invalid_signal", "Envie apenas sinalização offer, answer ou ice."));
      return;
    }

    const peer = this.participant(attachment.role === "host" ? "guest" : "host");
    if (!peer) {
      this.send(webSocket, websocketError("peer_unavailable", "O outro participante não está conectado."));
      return;
    }
    this.send(peer, { type: "signal", kind: message.kind, payload: message.payload });
  }

  async webSocketClose(
    webSocket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.handleDisconnect(webSocket);
  }

  async webSocketError(webSocket: WebSocket, _error: unknown): Promise<void> {
    await this.handleDisconnect(webSocket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(webSocket);
      if (attachment && !attachment.role && !attachment.cleaned && attachment.authDeadline <= now) {
        this.send(webSocket, websocketError("authentication_timeout", "Autenticação não recebida em 5 segundos."));
        attachment.cleaned = true;
        webSocket.serializeAttachment(attachment);
        this.safeClose(webSocket, 4401, "authentication_timeout");
      }
    }

    const room = this.room();
    if (!room) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (room.expires_at <= now) {
      await this.closeRoom("room_expired", 4001);
      return;
    }
    if (room.host_absent_since !== null && room.host_absent_since + HOST_GRACE_MS <= now) {
      await this.closeRoom("host_timeout", 4002);
      return;
    }
    await this.scheduleNextAlarm();
  }

  private async create(request: Request): Promise<Response> {
    if (!this.storageAvailable) {
      this.ensureSchema();
    }
    if (this.room()) return Response.json({ error: "room_exists" }, { status: 409 });

    let body: InternalCreateBody;
    try {
      body = await request.json<InternalCreateBody>();
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    if (
      !TOKEN_HASH_PATTERN.test(body.hostTokenHash) ||
      !TOKEN_HASH_PATTERN.test(body.guestTokenHash) ||
      !Number.isSafeInteger(body.expiresAt) ||
      body.expiresAt <= Date.now()
    ) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO room
        (singleton, host_token_hash, guest_token_hash, expires_at, host_absent_since)
       VALUES (1, ?, ?, ?, ?)`,
      body.hostTokenHash,
      body.guestTokenHash,
      body.expiresAt,
      Date.now(),
    );
    await this.scheduleNextAlarm();
    return Response.json({ created: true }, { status: 201 });
  }

  private async authorize(request: Request): Promise<Response> {
    const room = this.room();
    if (!room || room.expires_at <= Date.now()) {
      return Response.json({ error: "room_not_found" }, { status: 404 });
    }
    const token = request.headers.get("X-Participant-Token") ?? "";
    if (!isParticipantToken(token)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const role = await this.roleForToken(token, room);
    if (!role) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ role, expiresAt: room.expires_at });
  }

  private async deleteRoom(request: Request): Promise<Response> {
    const room = this.room();
    if (!room || room.expires_at <= Date.now()) {
      return Response.json({ error: "room_not_found" }, { status: 404 });
    }
    const token = request.headers.get("X-Participant-Token") ?? "";
    if (!isParticipantToken(token)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const suppliedHash = await hashToken(token);
    if (!constantTimeEqual(suppliedHash, room.host_token_hash)) {
      return Response.json({ error: "host_required" }, { status: 403 });
    }
    await this.closeRoom("host_ended", 4000);
    return Response.json({ closed: true });
  }

  private async upgradeWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "upgrade_required" }, { status: 426 });
    }
    const room = this.room();
    if (!room || room.expires_at <= Date.now()) {
      return Response.json({ error: "room_not_found" }, { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      role: null,
      authDeadline: Date.now() + AUTH_TIMEOUT_MS,
      cleaned: false,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    await this.scheduleNextAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async authenticateWebSocket(
    webSocket: WebSocket,
    attachment: SocketAttachment,
    value: unknown,
  ): Promise<void> {
    if (Date.now() > attachment.authDeadline) {
      this.send(webSocket, websocketError("authentication_timeout", "Autenticação não recebida em 5 segundos."));
      attachment.cleaned = true;
      webSocket.serializeAttachment(attachment);
      this.safeClose(webSocket, 4401, "authentication_timeout");
      return;
    }
    if (!this.isAuthMessage(value)) {
      this.send(webSocket, websocketError("authentication_required", "A primeira mensagem deve autenticar o participante."));
      attachment.cleaned = true;
      webSocket.serializeAttachment(attachment);
      this.safeClose(webSocket, 4401, "authentication_required");
      return;
    }

    const room = this.room();
    if (!room || room.expires_at <= Date.now()) {
      await this.closeRoom("room_expired", 4001);
      return;
    }
    const expectedRole = await this.roleForToken(value.token, room);
    if (expectedRole !== value.role) {
      this.send(webSocket, websocketError("authentication_failed", "Token ou papel de participante inválido."));
      attachment.cleaned = true;
      webSocket.serializeAttachment(attachment);
      this.safeClose(webSocket, 4403, "authentication_failed");
      return;
    }
    if (this.participant(value.role, webSocket)) {
      this.send(webSocket, websocketError("room_full", `A vaga de ${value.role} já está ocupada.`));
      attachment.cleaned = true;
      webSocket.serializeAttachment(attachment);
      this.safeClose(webSocket, 4409, "room_full");
      return;
    }

    attachment.role = value.role;
    webSocket.serializeAttachment(attachment);
    if (value.role === "host") {
      this.ctx.storage.sql.exec("UPDATE room SET host_absent_since = NULL WHERE singleton = 1");
    }
    const peer = this.participant(value.role === "host" ? "guest" : "host");
    this.send(webSocket, { type: "authenticated", role: value.role, peerConnected: Boolean(peer) });
    if (peer) this.send(peer, { type: "peer-joined" });
    await this.scheduleNextAlarm();
  }

  private async handleDisconnect(webSocket: WebSocket): Promise<void> {
    const attachment = this.attachment(webSocket);
    if (!attachment || attachment.cleaned) return;
    attachment.cleaned = true;
    try {
      webSocket.serializeAttachment(attachment);
    } catch {
      // The socket may already be fully disposed by the runtime.
    }
    if (!attachment.role) return;

    const peerRole = attachment.role === "host" ? "guest" : "host";
    const peer = this.participant(peerRole);
    if (peer) this.send(peer, { type: "peer-left" });

    const room = this.room();
    if (attachment.role === "host" && room && !this.participant("host", webSocket)) {
      this.ctx.storage.sql.exec(
        "UPDATE room SET host_absent_since = ? WHERE singleton = 1 AND host_absent_since IS NULL",
        Date.now(),
      );
      await this.scheduleNextAlarm();
    }
  }

  private async closeRoom(reason: string, closeCode: number): Promise<void> {
    for (const webSocket of this.ctx.getWebSockets()) {
      this.safeClose(webSocket, closeCode, reason);
    }
    this.storageAvailable = false;
    await this.ctx.storage.deleteAll();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const room = this.room();
    if (!room) return;
    const deadlines = [room.expires_at];
    if (room.host_absent_since !== null) deadlines.push(room.host_absent_since + HOST_GRACE_MS);
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(webSocket);
      if (attachment && !attachment.role && !attachment.cleaned) deadlines.push(attachment.authDeadline);
    }
    const nextAlarm = Math.max(Date.now() + 1, Math.min(...deadlines));
    await this.ctx.storage.setAlarm(nextAlarm);
  }

  private room(): RoomRecord | undefined {
    if (!this.storageAvailable) return undefined;
    try {
      return this.ctx.storage.sql
        .exec<RoomRecord>(
          "SELECT host_token_hash, guest_token_hash, expires_at, host_absent_since FROM room WHERE singleton = 1",
        )
        .toArray()[0];
    } catch {
      // deleteAll() removes the schema while this instance may still receive
      // close events or late requests before it is evicted.
      this.storageAvailable = false;
      return undefined;
    }
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        host_token_hash TEXT NOT NULL,
        guest_token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        host_absent_since INTEGER
      )
    `);
    this.storageAvailable = true;
  }

  private attachment(webSocket: WebSocket): SocketAttachment | undefined {
    try {
      const value: unknown = webSocket.deserializeAttachment();
      if (!isObject(value)) return undefined;
      const role = value.role;
      if (role !== null && !isRole(role)) return undefined;
      if (typeof value.authDeadline !== "number" || typeof value.cleaned !== "boolean") return undefined;
      return { role, authDeadline: value.authDeadline, cleaned: value.cleaned };
    } catch {
      return undefined;
    }
  }

  private participant(role: ParticipantRole, excluding?: WebSocket): WebSocket | undefined {
    return this.ctx.getWebSockets().find((webSocket) => {
      if (webSocket === excluding || webSocket.readyState !== 1) return false;
      const attachment = this.attachment(webSocket);
      return attachment?.role === role && !attachment.cleaned;
    });
  }

  private async roleForToken(token: string, room: RoomRecord): Promise<ParticipantRole | null> {
    const suppliedHash = await hashToken(token);
    if (constantTimeEqual(suppliedHash, room.host_token_hash)) return "host";
    if (constantTimeEqual(suppliedHash, room.guest_token_hash)) return "guest";
    return null;
  }

  private isAuthMessage(value: unknown): value is AuthMessage {
    return (
      isObject(value) &&
      value.type === "auth" &&
      isRole(value.role) &&
      isParticipantToken(value.token)
    );
  }

  private isSignalMessage(value: unknown): value is SignalMessage {
    return (
      isObject(value) &&
      value.type === "signal" &&
      isSignalKind(value.kind) &&
      validSignalPayload(value.kind, value.payload)
    );
  }

  private send(webSocket: WebSocket, payload: unknown): void {
    if (webSocket.readyState !== 1) return;
    try {
      webSocket.send(JSON.stringify(payload));
    } catch {
      // Disconnections race with presence/signaling messages.
    }
  }

  private safeClose(webSocket: WebSocket, code: number, reason: string): void {
    try {
      webSocket.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
