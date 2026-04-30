import { getAniwatchEpisodesByTitle, getAniwatchStreamByEpisodeId } from "@/lib/aniwatch";

export type ProviderKey = "aniwatch";

type EpisodeCandidate = {
  id: string;
  number: number;
  title?: string;
  filler?: boolean;
};

type EpisodeTokenPayload = {
  version: 1;
  provider: ProviderKey;
  rawEpisodeId: string;
  animeTitle: string;
  episodeNumber: number;
};

type ProviderAdapter = {
  key: ProviderKey;
  label: string;
  getEpisodes: (params: {
    title: string;
    extraTitles?: string[];
  }) => Promise<{
    providerAnimeId: string;
    episodes: EpisodeCandidate[];
  }>;
  getStream: (params: {
    rawEpisodeId: string;
    includeDebug?: boolean;
    timeoutMs?: number;
    onDebug?: (line: string) => void;
  }) => Promise<{
    videoUrl: string;
    headers: Record<string, string>;
    debug?: string[];
  }>;
};

export class ProviderChainStreamError extends Error {
  details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "ProviderChainStreamError";
    this.details = details;
  }
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

const providers: Record<ProviderKey, ProviderAdapter> = {
  aniwatch: {
    key: "aniwatch",
    label: "Anime API",
    getEpisodes: async (params) =>
      getAniwatchEpisodesByTitle(params.title, { extraTitles: params.extraTitles }),
    getStream: async (params) =>
      getAniwatchStreamByEpisodeId(params.rawEpisodeId, {
        includeDebug: params.includeDebug,
        timeoutMs: params.timeoutMs ?? 45_000,
      }),
  },
};

function parseProviderChain(): ProviderKey[] {
  return ["aniwatch"];
}

function encodeEpisodeToken(payload: EpisodeTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `ep1:${encoded}`;
}

function parseEpisodeToken(episodeId: string): EpisodeTokenPayload | null {
  if (!episodeId.startsWith("ep1:")) {
    return null;
  }

  const encoded = episodeId.slice(4);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EpisodeTokenPayload;
    if (
      parsed.version !== 1
      || parsed.provider !== "aniwatch"
      || !parsed.rawEpisodeId
      || !parsed.animeTitle
      || !Number.isFinite(parsed.episodeNumber)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function providerFromLegacyEpisodeId(episodeId: string): EpisodeTokenPayload {
  return {
    version: 1,
    provider: "aniwatch",
    rawEpisodeId: episodeId,
    animeTitle: "",
    episodeNumber: 0,
  };
}

export async function getEpisodesWithFallback(params: {
  title: string;
  extraTitles?: string[];
}): Promise<{
  providerKey: ProviderKey;
  providerLabel: string;
  providerAnimeId: string;
  episodes: Array<{
    id: string;
    number: number;
    title?: string;
    filler?: boolean;
  }>;
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];

  for (const providerKey of parseProviderChain()) {
    const adapter = providers[providerKey];
    try {
      const result = await adapter.getEpisodes({
        title: params.title,
        extraTitles: params.extraTitles,
      });

      const episodes = result.episodes.map((episode) => ({
        id: encodeEpisodeToken({
          version: 1,
          provider: providerKey,
          rawEpisodeId: episode.id,
          animeTitle: params.title,
          episodeNumber: episode.number,
        }),
        number: episode.number,
        title: episode.title,
        filler: episode.filler,
      }));

      if (episodes.length === 0) {
        diagnostics.push(`${adapter.label}: returned zero episodes`);
        continue;
      }

      return {
        providerKey,
        providerLabel: adapter.label,
        providerAnimeId: result.providerAnimeId,
        episodes,
        diagnostics,
      };
    } catch (error) {
      diagnostics.push(`${adapter.label}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  throw new Error(diagnostics.join(" | ") || "No provider could return episodes");
}

export async function getStreamWithFallback(params: {
  episodeId: string;
  includeDebug?: boolean;
  timeoutMs?: number;
}): Promise<{
  videoUrl: string;
  headers: Record<string, string>;
  providerKey: ProviderKey;
  providerLabel: string;
  debug: string[];
}> {
  const debug: string[] = [];
  const parsed = parseEpisodeToken(params.episodeId) ?? providerFromLegacyEpisodeId(params.episodeId);
  const primary = providers[parsed.provider];

  const tryResolve = async (
    provider: ProviderAdapter,
    rawEpisodeId: string,
  ) => {
    const line = `[${provider.label}] try stream rawEpisodeId=${rawEpisodeId}`;
    if (params.includeDebug) {
      debug.push(line);
    }

    try {
      const stream = await provider.getStream({
        rawEpisodeId,
        includeDebug: params.includeDebug,
        timeoutMs: params.timeoutMs ?? 45_000,
        onDebug: params.includeDebug
          ? (entry) => {
            debug.push(`[${provider.label}] ${entry}`);
          }
          : undefined,
      });

      if (params.includeDebug && stream.debug) {
        for (const entry of stream.debug) {
          debug.push(`[${provider.label}] ${entry}`);
        }
      }

      return {
        videoUrl: stream.videoUrl,
        headers: stream.headers,
        providerKey: provider.key,
        providerLabel: provider.label,
      };
    } catch (error) {
      if (params.includeDebug) {
        debug.push(`[${provider.label}] failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }

      return null;
    }
  };

  const primaryResolved = await tryResolve(primary, parsed.rawEpisodeId);
  if (primaryResolved) {
    return { ...primaryResolved, debug };
  }

  const details = dedupe(debug);
  throw new ProviderChainStreamError("No playable stream URL found from configured provider(s)", details);
}
