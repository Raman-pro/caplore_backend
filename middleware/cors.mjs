import { config } from "../lib/config.mjs";

const allowedOrigins = new Set(
  [
    "https://caplore.vercel.app",
    "https://www.caplore.in",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(config.allowedOrigins ?? "").split(","),
  ]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

export function corsMiddleware(request, response, next) {
  const origin = request.get("origin");

  if (origin && allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.vary("Origin");
    response.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (request.method === "OPTIONS") {
    return origin && allowedOrigins.has(origin)
      ? response.sendStatus(204)
      : response.sendStatus(403);
  }

  return next();
}
