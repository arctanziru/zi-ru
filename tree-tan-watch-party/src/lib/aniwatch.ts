import {
  AniwatchWordpressError,
  getAniwatchEpisodeServers,
  getAniwatchEpisodeSources,
  getAniwatchEpisodes,
  searchAniwatch,
} from "@/lib/aniwatch-wordpress";

type AniwatchSearchAnime = {
  id?: string;
  name?: string;
};

type MatchHints = {
  extraTitles?: string[];
};

type SupportedAniwatchServer = "hd-1" | "hd-2" | "streamsb" | "streamtape";
type EpisodeCategory = "sub" | "dub" | "raw";

export class StreamResolveError extends Error {
  details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "StreamResolveError";
    this.details = details;
  }
}

function dedupeDetails(details: string[]): string[] {
  return details.filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractSeasonNumber(text: string): number | null {
  const normalized = text.toLowerCase();
  const patterns = [
    /(?:^|\s)season\s*(\d+)(?:\s|$)/,
    /(?:^|\s)(\d+)(?:st|nd|rd|th)\s*season(?:\s|$)/,
    /(?:^|\s)(\d+)(?:st|nd|rd|th)(?:\s|$)/,
    /(?:^|\s)part\s*(\d+)(?:\s|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const seasonValue = Number(match[1]);
    if (Number.isFinite(seasonValue) && seasonValue > 0) {
      return seasonValue;
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

function scoreCandidateMatch(candidateName: string, query: string): number {
  const normalizedQuery = normalizeTitle(query);
  const normalizedName = normalizeTitle(candidateName);

  if (!normalizedQuery || !normalizedName) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (normalizedName === normalizedQuery) {
    score += 140;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    score += 70;
  }

  if (normalizedName.includes(normalizedQuery)) {
    score += 40;
  }

  if (normalizedQuery.includes(normalizedName)) {
    score += 20;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const nameTokens = normalizedName.split(" ").filter(Boolean);

  for (const token of queryTokens) {
    if (nameTokens.includes(token)) {
      score += 8;
    }
  }

  const requestedSeason = extractSeasonNumber(query);
  const candidateSeason = extractSeasonNumber(candidateName);

  if (requestedSeason !== null) {
    if (candidateSeason === requestedSeason) {
      score += 150;
    } else if (candidateSeason !== null && candidateSeason !== requestedSeason) {
      score -= 180;
    } else if (requestedSeason > 1) {
      score -= 70;
    }
  } else if (candidateSeason !== null) {
    score -= 24;
  }

  score -= Math.abs(normalizedName.length - normalizedQuery.length) * 0.25;
  return score;
}

function pickBestSearchMatch(
  query: string,
  results: AniwatchSearchAnime[],
  hints?: MatchHints,
): { id: string; name: string } | null {
  const queries = [query, ...(hints?.extraTitles ?? [])]
    .map((item) => item.trim())
    .filter(Boolean);

  let best: { id: string; name: string } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const item of results) {
    const id = item.id?.trim();
    const name = item.name?.trim() ?? "";
    if (!id || !name || queries.length === 0) {
      continue;
    }

    let score = Number.NEGATIVE_INFINITY;
    for (const searchQuery of queries) {
      score = Math.max(score, scoreCandidateMatch(name, searchQuery));
    }

    if (score > bestScore) {
      best = { id, name };
      bestScore = score;
    }
  }

  return best;
}

function normalizeServerAlias(serverName: string): SupportedAniwatchServer | null {
  const normalized = serverName.trim().toLowerCase();

  if (normalized === "hd-1" || normalized === "vidstreaming" || normalized === "vidsrc") {
    return "hd-1";
  }

  if (normalized === "hd-2" || normalized === "megacloud" || normalized === "t-cloud" || normalized === "vidcloud") {
    return "hd-2";
  }

  if (normalized === "streamsb") {
    return "streamsb";
  }

  if (normalized === "streamtape") {
    return "streamtape";
  }

  return null;
}

function classifyStreamFailure(details: string[]): string {
  const snapshot = details.join(" | ");

  if (snapshot.includes("Episode source was removed upstream")) {
    return "Episode source not found on current mirrors. The provider data may be stale or removed.";
  }

  if (snapshot.includes("Playable source URL not found")) {
    return "No playable stream URL found for that episode";
  }

  return "No playable stream URL found for that episode";
}

async function getEpisodeServers(
  episodeId: string,
  debugDetails?: string[],
): Promise<{
  servers: SupportedAniwatchServer[];
  categories: EpisodeCategory[];
}> {
  const debug = (message: string) => {
    debugDetails?.push(`[servers] ${message}`);
  };

  try {
    const payload = await getAniwatchEpisodeServers(episodeId);
    const listedServers = [...(payload.sub ?? []), ...(payload.dub ?? []), ...(payload.raw ?? [])]
      .map((server) => server.serverName?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeServerAlias(value))
      .filter((value): value is SupportedAniwatchServer => value !== null);

    const categories: EpisodeCategory[] = (["sub", "dub", "raw"] as EpisodeCategory[]).filter((category) =>
      Array.isArray(payload[category]) && (payload[category] ?? []).length > 0,
    );

    const fallbackOrder: SupportedAniwatchServer[] = ["hd-1", "hd-2"];
    const ordered = [...listedServers, ...fallbackOrder];
    const unique = ordered.filter((value, index, all) => all.indexOf(value) === index);
    const categoryOrder: EpisodeCategory[] = categories.length > 0 ? categories : ["sub"];
    debug(`resolved servers: ${unique.join(", ")}`);
    debug(`resolved categories: ${categoryOrder.join(", ")}`);
    return { servers: unique, categories: categoryOrder };
  } catch (error) {
    debug(error instanceof Error ? error.message : "server list failed");
    return { servers: ["hd-1", "hd-2"], categories: ["sub"] };
  }
}

export async function getAniwatchEpisodesByTitle(
  title: string,
  hints?: MatchHints,
): Promise<{
  providerAnimeId: string;
  episodes: Array<{
    id: string;
    number: number;
    title?: string;
    filler?: boolean;
  }>;
}> {
  const queryVariants = [...(hints?.extraTitles ?? []), title]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 5);

  const searchResults: AniwatchSearchAnime[] = [];
  for (const query of queryVariants) {
    const results = await searchAniwatch(query);
    searchResults.push(...results);
    if (results.length > 0) {
      break;
    }
  }

  const bestMatch = pickBestSearchMatch(title, searchResults, hints);
  if (!bestMatch?.id) {
    throw new Error("No streamable match found on the selected provider");
  }

  const episodesPayload = await getAniwatchEpisodes(bestMatch.id);
  const episodes = (episodesPayload.episodes ?? [])
    .map((episode, index) => ({
      id: episode.id.trim(),
      number: Number.isFinite(episode.number) ? Number(episode.number) : index + 1,
      title: episode.title,
      filler: Boolean(episode.isFiller),
    }))
    .filter((episode) => Boolean(episode.id))
    .sort((left, right) => left.number - right.number);

  if (episodes.length === 0) {
    throw new Error("No episodes available from the provider");
  }

  return {
    providerAnimeId: bestMatch.id,
    episodes,
  };
}

export async function getAniwatchStreamByEpisodeId(
  episodeId: string,
  options?: {
    includeDebug?: boolean;
    timeoutMs?: number;
  },
): Promise<{
  videoUrl: string;
  headers: Record<string, string>;
  debug?: string[];
}> {
  const debugDetails: string[] = [];
  const includeDebug = Boolean(options?.includeDebug);
  const serverInfo = await getEpisodeServers(episodeId, includeDebug ? debugDetails : undefined);
  const servers = serverInfo.servers;
  const categories = serverInfo.categories;

  let lastError: unknown;
  for (const category of categories) {
    for (const server of servers) {
      try {
        const payload = await getAniwatchEpisodeSources(episodeId, server, category);
        const sources = payload.sources ?? [];
        const source = sources.find((item) => item.isM3U8) ?? sources[0];
        const streamUrl = source?.url;

        if (!streamUrl) {
          if (includeDebug) {
            debugDetails.push(`[sources:${category}/${server}] no stream URL in ${sources.length} sources`);
          }
          continue;
        }

        return {
          videoUrl: streamUrl,
          headers: payload.headers ?? {},
          debug: includeDebug ? debugDetails : undefined,
        };
      } catch (error) {
        lastError = error;
        if (includeDebug) {
          debugDetails.push(`[sources:${category}/${server}] ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }
  }

  const finalDetails = dedupeDetails(debugDetails);
  if (lastError instanceof AniwatchWordpressError && finalDetails.length === 0) {
    finalDetails.push(lastError.message);
  }
  throw new StreamResolveError(classifyStreamFailure(finalDetails), finalDetails);
}
