type SearchResult = {
  id?: string;
  title?: string;
  name?: string;
  poster?: string;
};

type EpisodeResult = {
  episodeId?: string;
  number?: number;
  title?: string;
  isFiller?: boolean;
};

type SourceResult = {
  id?: string;
  title?: string;
  url?: string;
  directUrl?: string;
  downloadUrl?: string;
  corsHeaders?: Record<string, string>;
  headers?: Record<string, string>;
};

type FetchOptions = {
  timeoutMs?: number;
  onFailure?: (message: string) => void;
};

const DEFAULT_TIMEOUT_MS = 7000;

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractSeason(value: string): number | null {
  const normalized = value.toLowerCase();
  const patterns = [
    /(?:^|\s)season\s*(\d+)(?:\s|$)/,
    /(?:^|\s)(\d+)(?:st|nd|rd|th)\s*season(?:\s|$)/,
    /(?:^|\s)part\s*(\d+)(?:\s|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const asNumber = Number(match[1]);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
  }

  if (/\b2nd\b/.test(normalized)) {
    return 2;
  }

  if (/\b3rd\b/.test(normalized)) {
    return 3;
  }

  return null;
}

function scoreTitleCandidate(query: string, candidate: string): number {
  const left = normalizeTitle(query);
  const right = normalizeTitle(candidate);

  if (!left || !right) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (right === left) {
    score += 140;
  }

  if (right.startsWith(left)) {
    score += 60;
  }

  if (right.includes(left)) {
    score += 35;
  }

  if (left.includes(right)) {
    score += 20;
  }

  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  for (const token of leftTokens) {
    if (rightTokens.includes(token)) {
      score += 8;
    }
  }

  const leftSeason = extractSeason(query);
  const rightSeason = extractSeason(candidate);
  if (leftSeason !== null) {
    if (rightSeason === leftSeason) {
      score += 120;
    } else if (rightSeason !== null && rightSeason !== leftSeason) {
      score -= 180;
    } else if (leftSeason > 1) {
      score -= 70;
    }
  }

  score -= Math.abs(left.length - right.length) * 0.25;
  return score;
}

function getAnimepaheBaseUrls(): string[] {
  const configured = (
    process.env.ANIMEPAHE_API_BASE
    ?? process.env.NON_HIANIME_API_BASE
    ?? ""
  )
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return configured;
}

async function fetchFromBases<T>(
  path: string,
  options?: FetchOptions,
): Promise<T> {
  const bases = getAnimepaheBaseUrls();
  if (bases.length === 0) {
    throw new Error("AnimePahe adapter disabled. Set ANIMEPAHE_API_BASE first.");
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (const base of bases) {
    const target = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(target, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
        signal: controller.signal,
      });

      if (!response.ok) {
        options?.onFailure?.(`${base} ${path} -> HTTP ${response.status}`);
        lastError = new Error(`AnimePahe request failed (${response.status}) at ${base}`);
        continue;
      }

      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      options?.onFailure?.(`${base} ${path} -> ${message}`);
      lastError = error instanceof Error ? error : new Error("AnimePahe request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("AnimePahe source unavailable");
}

function pickSearchId(
  title: string,
  candidates: SearchResult[],
  hints?: string[],
): SearchResult | null {
  const queries = [title, ...(hints ?? [])]
    .map((item) => item.trim())
    .filter(Boolean);

  let best: SearchResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const name = (candidate.title ?? candidate.name ?? "").trim();
    const id = candidate.id?.trim();
    if (!name || !id) {
      continue;
    }

    let score = Number.NEGATIVE_INFINITY;
    for (const query of queries) {
      score = Math.max(score, scoreTitleCandidate(query, name));
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function unwrapArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    if (Array.isArray(data.results)) {
      return data.results;
    }
    if (Array.isArray(data.animes)) {
      return data.animes;
    }
    if (Array.isArray(data.episodes)) {
      return data.episodes;
    }
    if (data.data && typeof data.data === "object") {
      const nested = data.data as Record<string, unknown>;
      if (Array.isArray(nested.results)) {
        return nested.results;
      }
      if (Array.isArray(nested.animes)) {
        return nested.animes;
      }
      if (Array.isArray(nested.episodes)) {
        return nested.episodes;
      }
    }
  }

  return [];
}

export async function getAnimepaheEpisodesByTitle(params: {
  title: string;
  extraTitles?: string[];
}): Promise<{
  providerAnimeId: string;
  episodes: Array<{
    id: string;
    number: number;
    title?: string;
    filler?: boolean;
  }>;
}> {
  const searchPayload = await fetchFromBases<unknown>(
    `/api/v2/animepahe/search?q=${encodeURIComponent(params.title)}&page=1`,
    { timeoutMs: 7000 },
  );

  const searchResults = unwrapArray(searchPayload) as SearchResult[];
  const selected = pickSearchId(params.title, searchResults, params.extraTitles);
  const animeId = selected?.id?.trim();

  if (!animeId) {
    throw new Error("AnimePahe: no matching anime found");
  }

  const episodesPayload = await fetchFromBases<unknown>(
    `/api/v2/animepahe/anime/${encodeURIComponent(animeId)}/episodes`,
    { timeoutMs: 30_000 },
  );

  const parsedEpisodes = unwrapArray(episodesPayload) as EpisodeResult[];
  const episodes = parsedEpisodes
    .map((episode, index) => {
      const episodeId = episode.episodeId?.trim() ?? "";
      const number = Number.isFinite(episode.number) ? Number(episode.number) : index + 1;
      return {
        id: episodeId,
        number,
        title: episode.title,
        filler: Boolean(episode.isFiller),
      };
    })
    .filter((episode) => Boolean(episode.id))
    .sort((left, right) => left.number - right.number);

  if (episodes.length === 0) {
    throw new Error("AnimePahe: no episodes available");
  }

  return {
    providerAnimeId: animeId,
    episodes,
  };
}

export async function getAnimepaheStreamByEpisodeId(
  rawEpisodeId: string,
  options?: FetchOptions,
): Promise<{
  videoUrl: string;
  headers: Record<string, string>;
}> {
  const payload = await fetchFromBases<unknown>(
    `/api/v2/animepahe/episode/sources?animeEpisodeId=${encodeURIComponent(rawEpisodeId)}`,
    options,
  );

  const candidates = unwrapArray(payload) as SourceResult[];
  if (candidates.length === 0 && payload && typeof payload === "object") {
    const data = (payload as { data?: { sources?: SourceResult[] } }).data;
    if (Array.isArray(data?.sources)) {
      for (const source of data.sources) {
        candidates.push(source);
      }
    }
  }
  for (const source of candidates) {
    const direct =
      source.directUrl?.trim()
      ?? source.url?.trim()
      ?? source.downloadUrl?.trim()
      ?? "";

    if (!direct) {
      continue;
    }

    return {
      videoUrl: direct,
      headers: source.corsHeaders ?? source.headers ?? {},
    };
  }

  throw new Error("AnimePahe: no playable stream URL found");
}
