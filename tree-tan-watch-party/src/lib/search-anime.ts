import { unstable_cache } from "next/cache";
import { AnimeResult } from "@/lib/types";

type JikanAnime = {
  mal_id: number;
  title: string;
  synopsis: string | null;
  episodes: number | null;
  status: string;
  images?: {
    jpg?: {
      image_url?: string;
    };
  };
};

type JikanResponse = {
  data?: JikanAnime[];
};

async function fetchAnimeSearch(query: string): Promise<AnimeResult[]> {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=12`;

  const response = await fetch(url, {
    next: { revalidate: 300 },
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Anime provider unavailable");
  }

  const payload = (await response.json()) as JikanResponse;

  return (payload.data ?? []).map((anime) => ({
    id: String(anime.mal_id),
    title: anime.title,
    image: anime.images?.jpg?.image_url ?? "",
    synopsis: anime.synopsis ?? "No synopsis available.",
    episodes: anime.episodes,
    status: anime.status,
    subtitleAvailable: true,
  }));
}

export async function searchAnime(query: string): Promise<AnimeResult[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const getCachedSearch = unstable_cache(
    async () => fetchAnimeSearch(normalized),
    ["anime-search", normalized],
    { revalidate: 300 },
  );

  return getCachedSearch();
}
