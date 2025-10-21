import { WORKFLOW_ID } from "@/lib/config";
// Use undici Agent to tune connect/headers/body timeouts for Node fetch
// without pulling in extra deps (undici is built-in on modern Node).
import { Agent } from "undici";

export const runtime = "nodejs";

interface CreateSessionRequestBody {
  workflow?: { id?: string | null } | null;
  scope?: { user_id?: string | null } | null;
  workflowId?: string | null;
  chatkit_configuration?: {
    file_upload?: {
      enabled?: boolean;
    };
  };
}

const DEFAULT_CHATKIT_BASE = "https://api.openai.com";
const SESSION_COOKIE_NAME = "chatkit_session_id";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const DISABLE_SESSION_COOKIE =
  process.env.CHATKIT_DISABLE_SESSION_COOKIE === "1" ||
  process.env.CHATKIT_DISABLE_SESSION_COOKIE === "true";
const RETRY_ATTEMPTS = Number.parseInt(
  process.env.CHATKIT_RETRY_ATTEMPTS ?? "4",
  10
);
const RETRY_BASE_DELAY_MS = Number.parseInt(
  process.env.CHATKIT_RETRY_BASE_DELAY_MS ?? "500",
  10
);

const CONNECT_TIMEOUT_MS = Number.parseInt(
  process.env.CHATKIT_CONNECT_TIMEOUT_MS ?? "7000",
  10
);
const HEADERS_TIMEOUT_MS = Number.parseInt(
  process.env.CHATKIT_HEADERS_TIMEOUT_MS ?? "30000",
  10
);
const BODY_TIMEOUT_MS = Number.parseInt(
  process.env.CHATKIT_BODY_TIMEOUT_MS ?? "60000",
  10
);

const dispatcher = new Agent({
  // Shorter connect timeout encourages quicker failover to next retry/IP
  connect: { timeout: CONNECT_TIMEOUT_MS },
  headersTimeout: HEADERS_TIMEOUT_MS,
  bodyTimeout: BODY_TIMEOUT_MS,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
});

export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowedResponse();
  }
  let sessionCookie: string | null = null;
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({
          error: "Missing OPENAI_API_KEY environment variable",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const parsedBody = await safeParseJson<CreateSessionRequestBody>(request);
    const { userId, sessionCookie: resolvedSessionCookie } =
      await resolveUserId(request);
    sessionCookie = resolvedSessionCookie;
    const resolvedWorkflowId =
      parsedBody?.workflow?.id ?? parsedBody?.workflowId ?? WORKFLOW_ID;

    if (process.env.NODE_ENV !== "production") {
      console.info("[create-session] handling request", {
        resolvedWorkflowId,
        body: JSON.stringify(parsedBody),
      });
    }

    if (!resolvedWorkflowId) {
      return buildJsonResponse(
        { error: "Missing workflow id" },
        400,
        { "Content-Type": "application/json" },
        sessionCookie
      );
    }

    const apiBase = process.env.CHATKIT_API_BASE ?? DEFAULT_CHATKIT_BASE;
    const url = `${apiBase}/v1/chatkit/sessions`;
    const requestBody = JSON.stringify({
      workflow: { id: resolvedWorkflowId },
      user: userId,
      chatkit_configuration: {
        file_upload: {
          enabled:
            parsedBody?.chatkit_configuration?.file_upload?.enabled ?? false,
        },
      },
    });
    const upstreamResponse = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
        "OpenAI-Beta": "chatkit_beta=v1",
      },
      body: requestBody,
      // Pass tuned dispatcher to Node fetch (undici)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (process.env.NODE_ENV !== "production") {
      console.info("[create-session] upstream response", {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
      });
    }

    const upstreamJson = (await upstreamResponse.json().catch(() => ({}))) as
      | Record<string, unknown>
      | undefined;

    if (!upstreamResponse.ok) {
      const upstreamError = extractUpstreamError(upstreamJson);
      console.error("OpenAI ChatKit session creation failed", {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        body: upstreamJson,
      });
      return buildJsonResponse(
        {
          error:
            upstreamError ??
            `Failed to create session: ${upstreamResponse.statusText}`,
          details: upstreamJson,
        },
        upstreamResponse.status,
        { "Content-Type": "application/json" },
        sessionCookie
      );
    }

    const clientSecret = upstreamJson?.client_secret ?? null;
    const expiresAfter = upstreamJson?.expires_after ?? null;
    const responsePayload = {
      client_secret: clientSecret,
      expires_after: expiresAfter,
    };

    return buildJsonResponse(
      responsePayload,
      200,
      { "Content-Type": "application/json" },
      sessionCookie
    );
  } catch (error) {
    console.error("Create session error", error);
    const { status, message } = normalizeFetchError(error);
    return buildJsonResponse(
      { error: message },
      status,
      { "Content-Type": "application/json" },
      sessionCookie
    );
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowedResponse();
}

function methodNotAllowedResponse(): Response {
  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveUserId(request: Request): Promise<{
  userId: string;
  sessionCookie: string | null;
}> {
  if (DISABLE_SESSION_COOKIE) {
    return {
      userId: generateSessionId(),
      sessionCookie: null,
    };
  }

  const existing = getCookieValue(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME
  );
  if (existing) {
    return { userId: existing, sessionCookie: null };
  }

  const generated = generateSessionId();

  return {
    userId: generated,
    sessionCookie: serializeSessionCookie(generated),
  };
}

function generateSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function getCookieValue(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.split("=");
    if (!rawName || rest.length === 0) {
      continue;
    }
    if (rawName.trim() === name) {
      return rest.join("=").trim();
    }
  }
  return null;
}

function serializeSessionCookie(value: string): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function buildJsonResponse(
  payload: unknown,
  status: number,
  headers: Record<string, string>,
  sessionCookie: string | null
): Response {
  const responseHeaders = new Headers(headers);

  if (sessionCookie) {
    responseHeaders.append("Set-Cookie", sessionCookie);
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function normalizeFetchError(error: unknown): { status: number; message: string } {
  if (isRetriableFetchError(error)) {
    return {
      status: 504,
      message: "Timed out contacting OpenAI ChatKit. Please try again.",
    };
  }

  if (error instanceof Error && error.message) {
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Unexpected error" };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts: number = RETRY_ATTEMPTS
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < attempts) {
    attempt += 1;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await fetch(url, { ...(init as any), dispatcher } as any);
      if (!response.ok && shouldRetryStatus(response.status) && attempt < attempts) {
        await drainResponse(response);
        await wait(getBackoffDelayWithJitter(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isRetriableFetchError(error) || attempt >= attempts) {
        throw error;
      }
      if (process.env.NODE_ENV !== "production") {
        console.warn("[create-session] retrying upstream request", {
          attempt,
          error,
        });
      }
      await wait(getBackoffDelayWithJitter(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to reach OpenAI ChatKit.");
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetriableFetchError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string" &&
    String((error as { code?: unknown }).code).includes("TIMEOUT")
  ) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (
    cause &&
    typeof cause === "object" &&
    typeof (cause as { code?: unknown }).code === "string" &&
    String((cause as { code?: unknown }).code).includes("TIMEOUT")
  ) {
    return true;
  }

  return false;
}

function getBackoffDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function getBackoffDelayWithJitter(attempt: number): number {
  const base = getBackoffDelay(attempt);
  // Full jitter: multiply by random in [0.7, 1.3]
  const jitter = 0.7 + Math.random() * 0.6;
  return Math.max(100, Math.floor(base * jitter));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainResponse(response: Response): Promise<void> {
  if (response.body) {
    try {
      await response.body.cancel();
      return;
    } catch {
      // fall back to consuming the stream below
    }
  }

  try {
    await response.arrayBuffer();
  } catch {
    // ignore
  }
}

async function safeParseJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) {
      return null;
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractUpstreamError(
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) {
    return null;
  }

  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  const details = payload.details;
  if (typeof details === "string") {
    return details;
  }

  if (details && typeof details === "object" && "error" in details) {
    const nestedError = (details as { error?: unknown }).error;
    if (typeof nestedError === "string") {
      return nestedError;
    }
    if (
      nestedError &&
      typeof nestedError === "object" &&
      "message" in nestedError &&
      typeof (nestedError as { message?: unknown }).message === "string"
    ) {
      return (nestedError as { message: string }).message;
    }
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }
  return null;
}
