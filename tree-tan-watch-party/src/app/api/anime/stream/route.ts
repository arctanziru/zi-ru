import { getStreamWithFallback, ProviderChainStreamError } from "@/lib/provider-chain";
import { buildStreamProxyUrl } from "@/lib/stream-proxy";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as { episodeId?: string };
  const debugRequested = request.nextUrl.searchParams.get("debug") === "1";

  if (!payload.episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  try {
    const resolved = await getStreamWithFallback({
      episodeId: payload.episodeId,
      includeDebug: debugRequested,
      timeoutMs: 45_000,
    });

    const needsProxy =
      resolved.videoUrl.includes(".m3u8")
      && Object.keys(resolved.headers ?? {}).length > 0;

    const videoUrl = needsProxy
      ? buildStreamProxyUrl({
        origin: request.nextUrl.origin,
        url: resolved.videoUrl,
        headers: resolved.headers,
      })
      : resolved.videoUrl;

    return NextResponse.json({
      videoUrl,
      headers: resolved.headers,
      provider: {
        key: resolved.providerKey,
        label: resolved.providerLabel,
      },
      debug: debugRequested ? resolved.debug : undefined,
    });
  } catch (error) {
    if (error instanceof ProviderChainStreamError) {
      console.error("[anime/stream] provider chain failed", {
        episodeId: payload.episodeId,
        details: error.details,
      });

      return NextResponse.json(
        {
          error: error.message,
          details: debugRequested ? error.details : undefined,
        },
        { status: 502 },
      );
    }

    console.error("[anime/stream] unexpected resolver failure", {
      episodeId: payload.episodeId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve stream URL from provider",
        details: debugRequested && error instanceof Error ? [error.message] : undefined,
      },
      { status: 502 },
    );
  }
}
