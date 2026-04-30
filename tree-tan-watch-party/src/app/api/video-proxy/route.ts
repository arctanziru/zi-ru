import { decodeStreamProxyToken, buildStreamProxyUrl } from "@/lib/stream-proxy";
import { NextRequest, NextResponse } from "next/server";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

function pickUpstreamHeaders(headers?: Record<string, string>): HeadersInit {
  const picked = new Headers();
  const source = headers ?? {};

  for (const [key, value] of Object.entries(source)) {
    if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    picked.set(key, value);
  }

  return picked;
}

function proxyUrlFor(request: NextRequest, url: string, headers?: Record<string, string>): string {
  return buildStreamProxyUrl({
    origin: request.nextUrl.origin,
    url,
    headers,
  });
}

function rewritePlaylist(content: string, request: NextRequest, baseUrl: string, headers?: Record<string, string>) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (!trimmed.startsWith("#")) {
        const resolved = new URL(trimmed, baseUrl).toString();
        return proxyUrlFor(request, resolved, headers);
      }

      return line.replace(/URI="([^"]+)"/g, (_match, rawUrl: string) => {
        const resolved = new URL(rawUrl, baseUrl).toString();
        return `URI="${proxyUrlFor(request, resolved, headers)}"`;
      });
    })
    .join("\n");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  let payload;
  try {
    payload = decodeStreamProxyToken(token);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid stream proxy token" },
      { status: 400 },
    );
  }

  const upstreamHeaders = new Headers(pickUpstreamHeaders(payload.headers));
  const forwardedRange = request.headers.get("range");
  if (forwardedRange) {
    upstreamHeaders.set("Range", forwardedRange);
  }

  const upstreamResponse = await fetch(payload.url, {
    headers: upstreamHeaders,
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        error: `Upstream media request failed (${upstreamResponse.status})`,
        url: payload.url,
      },
      { status: upstreamResponse.status },
    );
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isPlaylist =
    payload.url.includes(".m3u8")
    || contentType.includes("mpegurl")
    || contentType.includes("vnd.apple.mpegurl");

  if (isPlaylist) {
    const text = await upstreamResponse.text();
    const rewritten = rewritePlaylist(text, request, upstreamResponse.url || payload.url, payload.headers);

    return new NextResponse(rewritten, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    });
  }

  const responseHeaders = new Headers();
  const passthroughHeaders = [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ];

  for (const headerName of passthroughHeaders) {
    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  }

  responseHeaders.set("Cache-Control", "no-store");

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
