export const runtime = "nodejs";

const SESSION_COOKIE_NAME = "chatkit_session_id";

export async function POST(): Promise<Response> {
  return buildResponse();
}

export async function GET(): Promise<Response> {
  return buildResponse();
}

function buildResponse(): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", serializeDeleteCookie());
  return new Response(JSON.stringify({ cleared: true }), {
    status: 200,
    headers,
  });
}

function serializeDeleteCookie(): string {
  // Expire immediately; match attributes used by create-session for reliability
  const parts = [
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}
