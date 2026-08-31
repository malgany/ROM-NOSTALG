import type { Env } from "./types";

export const MAX_HTTP_BODY_BYTES = 4 * 1024;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim().replace(/\/$/u, ""))
      .filter(Boolean),
  );
}

export function requireAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin")?.replace(/\/$/u, "");
  if (!origin || !allowedOrigins(env).has(origin)) {
    throw new ApiError(403, "origin_not_allowed", "Origem não autorizada.");
  }
  return origin;
}

export function corsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
}

export function jsonResponse(value: unknown, status = 200, origin?: string): Response {
  const headers = origin ? corsHeaders(origin) : new Headers({ "Cache-Control": "no-store" });
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

export function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
  }
  console.error("Unhandled Worker error", error);
  return jsonResponse(
    { error: { code: "internal_error", message: "Erro interno do serviço multiplayer." } },
    500,
    origin,
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Corpo da requisição excede o limite permitido.");
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Envie um corpo JSON.");
  }
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_HTTP_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Corpo da requisição excede o limite permitido.");
  }
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    throw new ApiError(400, "invalid_json", "JSON inválido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_body", "O corpo precisa ser um objeto JSON.");
  }
  return value as Record<string, unknown>;
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization);
  if (!match?.[1]) throw new ApiError(401, "unauthorized", "Token de participante ausente ou inválido.");
  return match[1];
}
