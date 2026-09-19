import { env } from "cloudflare:workers";
import {
  SELF,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashToken, randomBase64Url } from "../src/security";

const ORIGIN = "https://malgany.github.io";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURN_URL_PREFIX = "https://rtc.live.cloudflare.com/v1/turn/keys/";

interface RoomFixture {
  roomId: string;
  hostToken: string;
  guestToken: string;
  stub: DurableObjectStub;
}

function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  return SELF.fetch(`https://worker.example${path}`, { ...init, headers });
}

async function initializeRoom(expiresAt = Date.now() + 21_600_000): Promise<RoomFixture> {
  const roomId = randomBase64Url(16);
  const hostToken = randomBase64Url(32);
  const guestToken = randomBase64Url(32);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const [hostTokenHash, guestTokenHash] = await Promise.all([
    hashToken(hostToken),
    hashToken(guestToken),
  ]);
  const response = await stub.fetch("https://room.internal/internal/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostTokenHash, guestTokenHash, expiresAt }),
  });
  expect(response.status).toBe(201);
  return { roomId, hostToken, guestToken, stub };
}

async function openSocket(roomId: string): Promise<WebSocket> {
  const response = await apiRequest(`/v1/rooms/${roomId}/ws`, {
    method: "GET",
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const webSocket = response.webSocket!;
  webSocket.accept();
  return webSocket;
}

function nextJson(webSocket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 2_000);
    webSocket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
      },
      { once: true },
    );
  });
}

async function authenticate(
  webSocket: WebSocket,
  role: "host" | "guest",
  token: string,
): Promise<Record<string, unknown>> {
  const response = nextJson(webSocket);
  webSocket.send(JSON.stringify({ type: "auth", role, token }));
  return response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP boundary", () => {
  it("rejects missing/disallowed origins before touching a Durable Object", async () => {
    const missing = await SELF.fetch("https://worker.example/v1/rooms", { method: "POST" });
    expect(missing.status).toBe(403);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "origin_not_allowed" } });

    const disallowed = await SELF.fetch("https://worker.example/v1/rooms", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });
    expect(disallowed.status).toBe(403);
  });

  it("answers CORS preflight only for configured origins", async () => {
    const response = await apiRequest("/v1/rooms", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("rejects oversized and non-JSON room creation bodies", async () => {
    const unsupported = await apiRequest("/v1/rooms", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "CF-Connecting-IP": randomBase64Url(8) },
      body: "test",
    });
    expect(unsupported.status).toBe(415);

    const oversized = await apiRequest("/v1/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": randomBase64Url(8) },
      body: JSON.stringify({ turnstileToken: "x".repeat(5_000) }),
    });
    expect(oversized.status).toBe(413);
  });

  it("rate-limits room creation attempts by Cloudflare-provided client address", async () => {
    const clientAddress = `test-${randomBase64Url(8)}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await apiRequest("/v1/rooms", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "CF-Connecting-IP": clientAddress },
        body: "invalid",
      });
      expect(response.status).toBe(415);
    }
    const limited = await apiRequest("/v1/rooms", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "CF-Connecting-IP": clientAddress },
      body: "invalid",
    });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });
  });
});

describe("room creation and Cloudflare services", () => {
  it("validates Turnstile and creates 256-bit participant credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe(TURNSTILE_URL);
      return Response.json({ success: true, hostname: "malgany.github.io", action: "create-room" });
    });
    const before = Date.now();
    const response = await apiRequest("/v1/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": randomBase64Url(8) },
      body: JSON.stringify({ turnstileToken: "valid-token" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const room = await response.json<{
      roomId: string;
      hostToken: string;
      guestToken: string;
      expiresAt: number;
    }>();
    expect(room.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(room.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(room.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(room.hostToken).not.toBe(room.guestToken);
    expect(room.expiresAt).toBeGreaterThanOrEqual(before + 21_599_000);
    expect(room.expiresAt).toBeLessThanOrEqual(Date.now() + 21_600_000);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects a Turnstile result for a different hostname", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ success: true, hostname: "attacker.example", action: "create-room" }),
    );
    const response = await apiRequest("/v1/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": randomBase64Url(8) },
      body: JSON.stringify({ turnstileToken: "wrong-host" }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "turnstile_rejected" } });
  });

  it("authorizes either participant before issuing short-lived TURN credentials", async () => {
    const room = await initializeRoom();
    const iceServers = [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toMatch(new RegExp(`^${TURN_URL_PREFIX}`, "u"));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-turn-api-token");
      const ttl = Number(JSON.parse(String(init?.body)).ttl);
      expect(ttl).toBeGreaterThanOrEqual(21_590);
      expect(ttl).toBeLessThanOrEqual(21_600);
      return Response.json({ iceServers }, { status: 201 });
    });
    const response = await apiRequest(`/v1/rooms/${room.roomId}/ice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${room.guestToken}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ iceServers });
    expect(fetchSpy).toHaveBeenCalledOnce();

    const denied = await apiRequest(`/v1/rooms/${room.roomId}/ice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${randomBase64Url(32)}` },
    });
    expect(denied.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("never issues TURN credentials beyond the remaining room lifetime", async () => {
    const room = await initializeRoom(Date.now() + 90_000);
    let issuedTtl = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      issuedTtl = Number(JSON.parse(String(init?.body)).ttl);
      return Response.json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] }, { status: 201 });
    });

    const response = await apiRequest(`/v1/rooms/${room.roomId}/ice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${room.hostToken}` },
    });
    expect(response.status).toBe(200);
    expect(issuedTtl).toBeGreaterThanOrEqual(89);
    expect(issuedTtl).toBeLessThanOrEqual(90);
  });

  it("does not issue a TURN credential when less than one minute remains", async () => {
    const room = await initializeRoom(Date.now() + 30_000);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest(`/v1/rooms/${room.roomId}/ice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${room.guestToken}` },
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "room_expired" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Durable Object WebSocket room", () => {
  it("authenticates host and guest, reports presence, and relays only signaling", async () => {
    const room = await initializeRoom();
    const host = await openSocket(room.roomId);
    expect(await authenticate(host, "host", room.hostToken)).toEqual({
      type: "authenticated",
      role: "host",
      peerConnected: false,
    });

    const guest = await openSocket(room.roomId);
    const hostPresence = nextJson(host);
    expect(await authenticate(guest, "guest", room.guestToken)).toEqual({
      type: "authenticated",
      role: "guest",
      peerConnected: true,
    });
    expect(await hostPresence).toEqual({ type: "peer-joined" });

    const offer = { type: "offer", sdp: "v=0\r\n" };
    const relayed = nextJson(guest);
    host.send(JSON.stringify({ type: "signal", kind: "offer", payload: offer }));
    expect(await relayed).toEqual({ type: "signal", kind: "offer", payload: offer });

    const invalid = nextJson(host);
    host.send(JSON.stringify({ type: "controls", buttons: 1 }));
    expect(await invalid).toMatchObject({ type: "error", code: "invalid_signal" });
    host.close(1000, "done");
    guest.close(1000, "done");
  });

  it("rejects invalid first messages and a second participant in the same role", async () => {
    const room = await initializeRoom();
    const invalid = await openSocket(room.roomId);
    const invalidReply = nextJson(invalid);
    invalid.send(JSON.stringify({ type: "signal", kind: "ice", payload: null }));
    expect(await invalidReply).toMatchObject({ type: "error", code: "authentication_required" });

    const firstGuest = await openSocket(room.roomId);
    expect(await authenticate(firstGuest, "guest", room.guestToken)).toMatchObject({
      type: "authenticated",
      role: "guest",
    });
    const secondGuest = await openSocket(room.roomId);
    expect(await authenticate(secondGuest, "guest", room.guestToken)).toMatchObject({
      type: "error",
      code: "room_full",
    });
    firstGuest.close(1000, "done");
  });

  it("serializes authenticated socket metadata required for hibernation", async () => {
    const room = await initializeRoom();
    const host = await openSocket(room.roomId);
    expect(await authenticate(host, "host", room.hostToken)).toMatchObject({ type: "authenticated" });
    await runInDurableObject(room.stub, (_instance, state) => {
      const [server] = state.getWebSockets();
      expect(server?.deserializeAttachment()).toMatchObject({
        role: "host",
        authDeadline: expect.any(Number),
        cleaned: false,
      });
    });
    host.close(1000, "done");
  });

  it("closes unauthenticated sockets when their five-second alarm expires", async () => {
    const room = await initializeRoom();
    const webSocket = await openSocket(room.roomId);
    await runInDurableObject(room.stub, async (_instance, state) => {
      const [server] = state.getWebSockets();
      expect(server).toBeDefined();
      server!.serializeAttachment({ role: null, authDeadline: Date.now() - 1, cleaned: false });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const response = nextJson(webSocket);
    expect(await runDurableObjectAlarm(room.stub)).toBe(true);
    expect(await response).toMatchObject({ type: "error", code: "authentication_timeout" });
  });
});

describe("lifecycle and authorization", () => {
  it("allows only the host to delete a room", async () => {
    const room = await initializeRoom();
    const guestAttempt = await apiRequest(`/v1/rooms/${room.roomId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${room.guestToken}` },
    });
    expect(guestAttempt.status).toBe(403);

    const closed = await apiRequest(`/v1/rooms/${room.roomId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${room.hostToken}` },
    });
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toEqual({ closed: true });

    const gone = await apiRequest(`/v1/rooms/${room.roomId}/ice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${room.hostToken}` },
    });
    expect(gone.status).toBe(404);

    await runInDurableObject(room.stub, async (_instance, state) => {
      const roomTables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room'",
        )
        .toArray();
      expect(roomTables).toEqual([]);
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it("purges expired rooms and rooms whose host grace period elapsed", async () => {
    const expired = await initializeRoom();
    await runInDurableObject(expired.stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE room SET expires_at = ? WHERE singleton = 1", Date.now() - 1);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(expired.stub)).toBe(true);
    const expiredAuth = await expired.stub.fetch("https://room.internal/internal/auth", {
      method: "POST",
      headers: { "X-Participant-Token": expired.hostToken },
    });
    expect(expiredAuth.status).toBe(404);

    const abandoned = await initializeRoom();
    await runInDurableObject(abandoned.stub, async (_instance, state) => {
      const createdState = state.storage.sql
        .exec<{ host_absent_since: number }>(
          "SELECT host_absent_since FROM room WHERE singleton = 1",
        )
        .one();
      expect(createdState.host_absent_since).toBeGreaterThan(0);
      expect(createdState.host_absent_since).toBeLessThanOrEqual(Date.now());
      const initialAlarm = await state.storage.getAlarm();
      expect(initialAlarm).not.toBeNull();
      expect(initialAlarm!).toBeLessThanOrEqual(Date.now() + 60_000);
      state.storage.sql.exec(
        "UPDATE room SET host_absent_since = ? WHERE singleton = 1",
        Date.now() - 60_001,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(abandoned.stub)).toBe(true);
    const abandonedAuth = await abandoned.stub.fetch("https://room.internal/internal/auth", {
      method: "POST",
      headers: { "X-Participant-Token": abandoned.hostToken },
    });
    expect(abandonedAuth.status).toBe(404);
  });
});
