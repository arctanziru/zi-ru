import { Buffer } from "node:buffer";

type StreamProxyPayload = {
  url: string;
  headers?: Record<string, string>;
};

export function buildStreamProxyUrl(input: {
  origin: string;
  url: string;
  headers?: Record<string, string>;
}): string {
  const payload: StreamProxyPayload = {
    url: input.url,
    headers: input.headers ?? {},
  };

  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${input.origin}/api/video-proxy?token=${encodeURIComponent(token)}`;
}

export function decodeStreamProxyToken(token: string): StreamProxyPayload {
  const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as StreamProxyPayload;

  if (!parsed?.url || typeof parsed.url !== "string") {
    throw new Error("Invalid stream proxy token");
  }

  return {
    url: parsed.url,
    headers:
      parsed.headers && typeof parsed.headers === "object"
        ? parsed.headers
        : {},
  };
}
