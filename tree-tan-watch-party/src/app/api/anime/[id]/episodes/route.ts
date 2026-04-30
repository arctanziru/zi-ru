import { getEpisodesWithFallback } from "@/lib/provider-chain";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

type JikanDetailResponse = {
  data?: {
    title?: string;
    title_english?: string | null;
    title_japanese?: string | null;
    title_synonyms?: string[];
  };
};

async function getJikanTitleHints(animeId: string): Promise<string[]> {
  const malId = Number(animeId);
  if (!Number.isFinite(malId) || malId <= 0) {
    return [];
  }

  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as JikanDetailResponse;
    const data = payload.data;

    if (!data) {
      return [];
    }

    return [
      data.title ?? "",
      data.title_english ?? "",
      data.title_japanese ?? "",
      ...(data.title_synonyms ?? []),
    ]
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 5);
  } catch {
    return [];
  }
}

const getCachedEpisodesForTitle = unstable_cache(
  async (animeId: string, title: string) => {
    const titleHints = await getJikanTitleHints(animeId);
    return await getEpisodesWithFallback({
      title,
      extraTitles: titleHints,
    });
  },
  ["anime-episodes-by-title", "anime-api-unified-provider-route-v2"],
  { revalidate: 300 },
);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const title = request.nextUrl.searchParams.get("title")?.trim();

  if (!id) {
    return NextResponse.json({ error: "Missing anime id" }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "Missing anime title query param" }, { status: 400 });
  }

  try {
    const resolved = await getCachedEpisodesForTitle(id, title);

    const episodes = resolved.episodes.map((episode) => ({
      id: episode.id,
      number: episode.number,
      title: episode.title ?? `Episode ${episode.number}`,
      titleJapanese: null,
      aired: null,
      filler: Boolean(episode.filler),
      recap: false,
    }));

    return NextResponse.json({
      episodes,
      providerAnimeId: resolved.providerAnimeId,
      provider: {
        key: resolved.providerKey,
        label: resolved.providerLabel,
      },
      diagnostics: resolved.diagnostics,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch episodes",
      },
      { status: 500 },
    );
  }
}
