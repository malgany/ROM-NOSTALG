import { generateIceServers, verifyTurnstile } from "./cloudflare-services";
import {
  ApiError,
  bearerToken,
  corsHeaders,
  errorResponse,
  jsonResponse,
  readJsonObject,
  requireAllowedOrigin,
} from "./http";
import { hashToken, isParticipantToken, isRoomId, randomBase64Url } from "./security";
import type { Env } from "./types";

export { Room } from "./room";

const DEFAULT_ROOM_TTL_SECONDS = 21_600;
const MIN_ROOM_TTL_SECONDS = 60;
const MAX_ROOM_TTL_SECONDS = 21_600;
const ROOM_PATH = /^\/v1\/rooms\/([^/]+)(?:\/(ws|ice))?$/u;

interface RoomPathMatch {
  roomId: string;
  endpoint?: "ws" | "ice";
}

function roomTtlMilliseconds(env: Env): number {
  const configured = Number.parseInt(env.ROOM_TTL_SECONDS ?? String(DEFAULT_ROOM_TTL_SECONDS), 10);
  const seconds = Number.isFinite(configured)
    ? Math.min(MAX_ROOM_TTL_SECONDS, Math.max(MIN_ROOM_TTL_SECONDS, configured))
    : DEFAULT_ROOM_TTL_SECONDS;
  return seconds * 1_000;
}

function parseRoomPath(pathname: string): RoomPathMatch | null {
  const match = ROOM_PATH.exec(pathname);
  const roomId = match?.[1];
  if (!roomId || !isRoomId(roomId)) return null;
  const endpoint = match[2];
  if (endpoint === "ws" || endpoint === "ice") return { roomId, endpoint };
  return { roomId };
}

function requireSecret(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    console.error(`Missing required Worker secret: ${name}`);
    throw new ApiError(503, "service_not_configured", "Serviço multiplayer ainda não configurado.");
  }
  return value;
}

async function applyRateLimit(env: Env, key: string): Promise<void> {
  const result = await env.ROOM_CREATE_RATE_LIMITER.limit({ key });
  if (!result.success) {
    throw new ApiError(429, "rate_limited", "Muitas tentativas. Aguarde um minuto e tente novamente.");
  }
}

function roomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

async function createRoom(request: Request, origin: string, env: Env): Promise<Response> {
  const ipAddress = request.headers.get("CF-Connecting-IP") ?? "unknown";
  await applyRateLimit(env, `create:${ipAddress}`);

  const body = await readJsonObject(request);
  requireSecret(env.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
  await verifyTurnstile(body.turnstileToken, request, origin, env);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const roomId = randomBase64Url(16);
    const hostToken = randomBase64Url(32);
    const guestToken = randomBase64Url(32);
    const expiresAt = Date.now() + roomTtlMilliseconds(env);
    const [hostTokenHash, guestTokenHash] = await Promise.all([
      hashToken(hostToken),
      hashToken(guestToken),
    ]);
    const response = await roomStub(env, roomId).fetch("https://room.internal/internal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostTokenHash, guestTokenHash, expiresAt }),
    });
    if (response.ok) {
      return jsonResponse({ roomId, hostToken, guestToken, expiresAt }, 201, origin);
    }
    if (response.status !== 409) {
      throw new ApiError(500, "room_creation_failed", "Não foi possível criar a sala.");
    }
  }
  throw new ApiError(503, "room_id_unavailable", "Não foi possível reservar um identificador de sala.");
}

async function authorizeParticipant(
  request: Request,
  env: Env,
  roomId: string,
): Promise<{ token: string; role: "host" | "guest"; expiresAt: number }> {
  const token = bearerToken(request);
  if (!isParticipantToken(token)) {
    throw new ApiError(401, "unauthorized", "Token de participante ausente ou inválido.");
  }
  const response = await roomStub(env, roomId).fetch("https://room.internal/internal/auth", {
    method: "POST",
    headers: { "X-Participant-Token": token },
  });
  if (response.status === 404) throw new ApiError(404, "room_not_found", "Sala inexistente ou expirada.");
  if (!response.ok) throw new ApiError(401, "unauthorized", "Token de participante inválido.");
  const payload = await response.json<{ role?: unknown; expiresAt?: unknown }>();
  if (payload.role !== "host" && payload.role !== "guest") {
    throw new ApiError(500, "invalid_room_state", "Estado interno inválido da sala.");
  }
  if (!Number.isSafeInteger(payload.expiresAt) || Number(payload.expiresAt) <= Date.now()) {
    throw new ApiError(404, "room_not_found", "Sala inexistente ou expirada.");
  }
  return { token, role: payload.role, expiresAt: Number(payload.expiresAt) };
}

async function issueIceCredentials(
  request: Request,
  origin: string,
  env: Env,
  roomId: string,
): Promise<Response> {
  const participant = await authorizeParticipant(request, env, roomId);
  await applyRateLimit(env, `ice:${roomId}:${participant.role}`);
  requireSecret(env.TURN_KEY_ID, "TURN_KEY_ID");
  requireSecret(env.TURN_KEY_API_TOKEN, "TURN_KEY_API_TOKEN");
  const remainingRoomSeconds = Math.ceil((participant.expiresAt - Date.now()) / 1_000);
  if (remainingRoomSeconds < 60) {
    throw new ApiError(410, "room_expired", "A sala está perto de expirar; crie um novo convite.");
  }
  const iceServers = await generateIceServers(env, remainingRoomSeconds);
  return jsonResponse({ iceServers }, 200, origin);
}

async function deleteRoom(
  request: Request,
  origin: string,
  env: Env,
  roomId: string,
): Promise<Response> {
  const token = bearerToken(request);
  if (!isParticipantToken(token)) {
    throw new ApiError(401, "unauthorized", "Token de participante ausente ou inválido.");
  }
  const response = await roomStub(env, roomId).fetch("https://room.internal/internal/room", {
    method: "DELETE",
    headers: { "X-Participant-Token": token },
  });
  if (response.status === 404) throw new ApiError(404, "room_not_found", "Sala inexistente ou expirada.");
  if (response.status === 401) throw new ApiError(401, "unauthorized", "Token de participante inválido.");
  if (response.status === 403) throw new ApiError(403, "host_required", "Somente o host pode encerrar a sala.");
  if (!response.ok) throw new ApiError(500, "room_close_failed", "Não foi possível encerrar a sala.");
  return jsonResponse({ closed: true }, 200, origin);
}

async function upgradeWebSocket(request: Request, env: Env, roomId: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(426, "upgrade_required", "Esta rota requer Upgrade: websocket.");
  }
  return roomStub(env, roomId).fetch("https://room.internal/ws", {
    method: "GET",
    headers: { Upgrade: "websocket" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    let origin: string | undefined;
    try {
      const url = new URL(request.url);
      origin = requireAllowedOrigin(request, env);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      if (request.method === "POST" && url.pathname === "/v1/rooms") {
        return await createRoom(request, origin, env);
      }

      const match = parseRoomPath(url.pathname);
      if (!match) throw new ApiError(404, "not_found", "Rota não encontrada.");
      if (request.method === "GET" && match.endpoint === "ws") {
        return await upgradeWebSocket(request, env, match.roomId);
      }
      if (request.method === "POST" && match.endpoint === "ice") {
        return await issueIceCredentials(request, origin, env, match.roomId);
      }
      if (request.method === "DELETE" && !match.endpoint) {
        return await deleteRoom(request, origin, env, match.roomId);
      }
      throw new ApiError(405, "method_not_allowed", "Método não permitido para esta rota.");
    } catch (error) {
      return errorResponse(error, origin);
    }
  },
} satisfies ExportedHandler<Env>;
