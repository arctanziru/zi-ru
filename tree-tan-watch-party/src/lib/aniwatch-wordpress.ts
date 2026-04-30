import { Buffer } from "node:buffer";
import axios, { type AxiosRequestConfig } from "axios";
import { load } from "cheerio";

const DEFAULT_BASE_URL = "https://aniwatch.co.at";
const DEFAULT_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
} as const;
const DEFAULT_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 9_000;
const DEFAULT_ATTEMPTS = 2;

type SearchItem = {
  id: number;
  title: string;
  url: string;
};

type AnimeToken = {
  v: 1;
  kind: "anime";
  title: string;
  seedPageUrl: string;
};

type EpisodeToken = {
  v: 1;
  kind: "episode";
  title: string;
  episodePageUrl: string;
  number: number;
};

type WatchPageContext = {
  nonce: string;
  postId: string;
  animeId?: string;
  restWatchUrl?: string;
};

type WordpressAjaxResponse = {
  status?: boolean;
  html?: string;
  dl_link?: string;
};

type WordpressRestResponse = {
  status?: boolean;
  html?: string;
  totalItems?: number;
};

type PlayerPayload = {
  source?: string;
  tracks?: Array<{
    file?: string;
    label?: string;
    kind?: string;
    default?: boolean;
  }>;
};

type EpisodeServerEntry = {
  category: "sub" | "dub" | "raw";
  serverName: string;
  hash: string;
};

export class AniwatchWordpressError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AniwatchWordpressError";
    this.status = status;
  }
}

export function getAniwatchSiteBase(): string {
  return (process.env.ANIWATCH_SITE_BASE || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

function encodeToken(payload: AnimeToken | EpisodeToken): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeToken<T extends AnimeToken | EpisodeToken>(
  raw: string,
  kind: T["kind"],
): T {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
    if (parsed.v !== 1 || parsed.kind !== kind) {
      throw new Error("invalid token kind");
    }
    return parsed;
  } catch {
    throw new AniwatchWordpressError(`Invalid ${kind} id`, 400);
  }
}

function normalizeSeriesTitle(rawTitle: string): string {
  const decodedTitle = load(`<div>${rawTitle}</div>`).text();
  return decodedTitle
    .replace(/\s+Episode\s+\d+.*$/i, "")
    .replace(/\s+English\s+(Sub|Dub)(bed)?$/i, "")
    .replace(/\s+at\s+Aniwatch$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSeasonNumber(title: string): number | null {
  const normalized = title.toLowerCase();
  const match =
    normalized.match(/(?:^|\s)season\s*(\d+)(?:\s|$)/)
    || normalized.match(/(?:^|\s)(\d+)(?:st|nd|rd|th)\s*season(?:\s|$)/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stripSeasonSuffix(title: string): string {
  return title
    .replace(/[’‘]/g, "'")
    .replace(/\s+season\s+\d+$/i, "")
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season$/i, "")
    .replace(/[^a-z0-9']+/gi, " ")
    .trim()
    .toLowerCase();
}

function normalizeServerName(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "vidsrc" || normalized === "hd") {
    return "hd-1";
  }
  if (normalized === "fast player") {
    return "hd-2";
  }
  return normalized;
}

async function requestWithRetry<T>(
  config: AxiosRequestConfig,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await axios.request<T>({
        timeout: timeoutMs,
        validateStatus: () => true,
        ...config,
      });
      if (response.status >= 400) {
        throw new AniwatchWordpressError(
          `Upstream request failed (${response.status})`,
          response.status,
        );
      }
      return response.data;
    } catch (error) {
      lastError = error;
      if (!(axios.isAxiosError(error) && error.code === "ECONNABORTED")) {
        break;
      }
    }
  }
  throw lastError;
}

async function fetchText(
  url: string,
  init?: Omit<AxiosRequestConfig, "url"> & { timeoutMs?: number },
): Promise<string> {
  return await requestWithRetry<string>({
    url,
    method: init?.method || "GET",
    data: init?.data,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers ?? {}),
    },
  }, DEFAULT_ATTEMPTS, init?.timeoutMs);
}

async function fetchJson<T>(
  url: string,
  init?: Omit<AxiosRequestConfig, "url"> & { timeoutMs?: number },
): Promise<T> {
  return await requestWithRetry<T>({
    url,
    method: init?.method || "GET",
    data: init?.data,
    headers: {
      Accept: "application/json",
      "User-Agent": DEFAULT_HEADERS["User-Agent"],
      ...(init?.headers ?? {}),
    },
  }, DEFAULT_ATTEMPTS, init?.timeoutMs);
}

async function searchWordpressPosts(query: string): Promise<SearchItem[]> {
  const baseUrl = getAniwatchSiteBase();
  const url = `${baseUrl}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=30`;
  const payload = await fetchJson<SearchItem[]>(url, {
    timeoutMs: SEARCH_TIMEOUT_MS,
  });
  return payload.filter((item) => item.url.startsWith(baseUrl));
}

function buildSearchVariants(query: string): string[] {
  const normalized = query.trim();
  const noSeason = normalized
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season$/i, "")
    .replace(/\s+season\s+\d+$/i, "")
    .trim();
  const afterNoParticle = noSeason.includes(" no ")
    ? noSeason.split(/\s+no\s+/i).at(-1)?.trim() || ""
    : "";

  return [
    normalized,
    normalized.split(":")[0]?.trim() || "",
    noSeason,
    afterNoParticle ? `${afterNoParticle} Season ${extractSeasonNumber(normalized) ?? ""}`.trim() : "",
    afterNoParticle,
  ]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

export async function searchAniwatch(query: string) {
  const settledVariantResults = await Promise.allSettled(
    buildSearchVariants(query).map((variant) => searchWordpressPosts(variant)),
  );
  const items = settledVariantResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []);

  if (items.length === 0) {
    const firstFailure = settledVariantResults.find((result) => result.status === "rejected");
    if (firstFailure?.status === "rejected") {
      const reason = firstFailure.reason;
      if (reason instanceof AniwatchWordpressError) {
        throw reason;
      }
      if (axios.isAxiosError(reason) && reason.code === "ECONNABORTED") {
        throw new AniwatchWordpressError("Aniwatch search upstream timed out", 504);
      }
      throw new AniwatchWordpressError("Aniwatch search upstream failed", 502);
    }
  }

  const grouped = new Map<string, { title: string; sample: SearchItem }>();
  for (const item of items) {
    const title = normalizeSeriesTitle(item.title);
    if (!title) {
      continue;
    }
    const key = title.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, { title, sample: item });
    }
  }

  const results: Array<{ id: string; name: string }> = [];
  for (const { title, sample } of grouped.values()) {
    results.push({
      id: encodeToken({
        v: 1,
        kind: "anime",
        title,
        seedPageUrl: sample.url,
      }),
      name: title,
    });
  }

  if (extractSeasonNumber(query) === null) {
    const baseTitleSet = new Set(
      results
        .filter((item) => extractSeasonNumber(item.name) === null)
        .map((item) => stripSeasonSuffix(item.name)),
    );

    return results.filter((item) => {
      const candidateSeason = extractSeasonNumber(item.name);
      if (candidateSeason === null) {
        return true;
      }
      return !baseTitleSet.has(stripSeasonSuffix(item.name));
    });
  }

  return results;
}

function extractNonce(html: string): string {
  const commentsNonceMatch = html.match(/hianime_comments\s*=\s*\{[\s\S]*?"nonce":"([^"]+)"/i);
  const legacyNonceMatch = html.match(/hianime_ep_ajax\s*=\s*\{"ajax_url":"[^"]+","episode_nonce":"([^"]+)"\}/i);
  const nonce = commentsNonceMatch?.[1]?.trim() || legacyNonceMatch?.[1]?.trim();
  if (!nonce) {
    throw new AniwatchWordpressError("Watch page nonce not found", 502);
  }
  return nonce;
}

function extractPostId(html: string): string {
  const restMatch = html.match(/wp-json\/wp\/v2\/posts\/(\d+)/i);
  const postId = restMatch?.[1]?.trim();
  if (!postId) {
    throw new AniwatchWordpressError("Post id not found", 502);
  }
  return postId;
}

function extractCommentsContext(html: string): WatchPageContext {
  const nonce = extractNonce(html);
  const restWatchUrl = html.match(/hianime_ep_ajax\s*=\s*\{"rest_url":"([^"]+)"/i)?.[1]?.trim();
  const commentsMatch = html.match(
    /hianime_comments\s*=\s*\{[\s\S]*?"post_id":"(\d+)"[\s\S]*?"anime_id":"(\d+)"/i,
  );

  if (!commentsMatch) {
    return {
      nonce,
      postId: extractPostId(html),
      restWatchUrl,
    };
  }

  return {
    nonce,
    postId: commentsMatch[1],
    animeId: commentsMatch[2],
    restWatchUrl,
  };
}

function buildWorkingUrlCandidates(url: string): string[] {
  const trimmed = url.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/-english-subi\/?$/i, "-english-sub/"),
    trimmed.replace(/-english-subbed\/?$/i, "-english-sub/"),
    trimmed.replace(/\/?$/, "/"),
  ];
  return candidates.filter((value, index, all) => all.indexOf(value) === index);
}

async function resolveAnimePageUrl(token: AnimeToken): Promise<string> {
  for (const candidate of buildWorkingUrlCandidates(token.seedPageUrl)) {
    try {
      const html = await fetchText(candidate);
      if (/hianime_comments|hianime_ep_ajax/i.test(html)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  const results = await searchAniwatch(token.title);
  const refreshed = results.find((item) => item.name.trim().toLowerCase() === token.title.trim().toLowerCase());
  if (refreshed?.id) {
    const refreshedToken = decodeToken<AnimeToken>(refreshed.id, "anime");
    for (const candidate of buildWorkingUrlCandidates(refreshedToken.seedPageUrl)) {
      try {
        const html = await fetchText(candidate);
        if (/hianime_comments|hianime_ep_ajax/i.test(html)) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return token.seedPageUrl;
}

async function fetchAnimePageContext(animePageUrl: string) {
  const html = await fetchText(animePageUrl);
  const context = extractCommentsContext(html);
  return {
    nonce: context.nonce,
    animeId: context.animeId || extractPostId(html),
    restWatchUrl: context.restWatchUrl,
  };
}

async function postWordpressAjax(
  referer: string,
  body: Record<string, string>,
): Promise<WordpressAjaxResponse> {
  const url = `${getAniwatchSiteBase()}/wp-admin/admin-ajax.php`;
  return await fetchJson<WordpressAjaxResponse>(url, {
    method: "POST",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    data: new URLSearchParams(body).toString(),
  });
}

async function getWordpressWatchRest<T>(restUrl: string, path: string): Promise<T> {
  const normalizedBase = restUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return await fetchJson<T>(`${normalizedBase}/${normalizedPath}`);
}

async function getEpisodeServersPayload(
  episodePageUrl: string,
  context: WatchPageContext,
): Promise<WordpressRestResponse | WordpressAjaxResponse> {
  if (context.restWatchUrl) {
    const restPaths = [
      `episode/servers/${encodeURIComponent(context.postId)}`,
      `episode/servers?episodeId=${encodeURIComponent(context.postId)}`,
    ];

    let lastError: unknown;
    for (const restPath of restPaths) {
      try {
        return await getWordpressWatchRest<WordpressRestResponse>(context.restWatchUrl, restPath);
      } catch (error) {
        lastError = error;
        if (!(error instanceof AniwatchWordpressError) || error.status !== 404) {
          throw error;
        }
      }
    }

    if (lastError && !(lastError instanceof AniwatchWordpressError && lastError.status === 404)) {
      throw lastError;
    }
  }

  return await postWordpressAjax(episodePageUrl, {
    action: "hianime_episode_servers",
    episode_id: context.postId,
    nonce: context.nonce,
  });
}

function parseEpisodesHtml(html: string) {
  const $ = load(html);
  const episodes: Array<{
    id: string;
    number: number;
    title: string;
    isFiller: boolean;
  }> = [];

  $(".ep-item").each((_, node) => {
    const episodePageUrl = $(node).attr("href")?.trim();
    const number = Number($(node).attr("data-number") || "");
    const title =
      $(node).attr("title")?.trim()
      || $(node).find(".ep-name").text().trim()
      || `Episode ${number}`;

    if (!episodePageUrl || !Number.isFinite(number)) {
      return;
    }

    episodes.push({
      id: encodeToken({
        v: 1,
        kind: "episode",
        title,
        episodePageUrl,
        number,
      }),
      number,
      title,
      isFiller: false,
    });
  });

  episodes.sort((left, right) => left.number - right.number);
  return episodes;
}

function parseServerEntries(html: string): EpisodeServerEntry[] {
  const $ = load(html);
  const entries: EpisodeServerEntry[] = [];

  $(".server-item").each((_, node) => {
    const category = ($(node).attr("data-type")?.trim().toLowerCase() || "sub") as EpisodeServerEntry["category"];
    const serverName = $(node).attr("data-server-name")?.trim() || "VidSrc";
    const hash = $(node).attr("data-hash")?.trim() || "";
    if (!hash) {
      return;
    }
    entries.push({ category, serverName, hash });
  });

  return entries;
}

function decodeHash(hash: string): string {
  try {
    return Buffer.from(hash, "base64").toString("utf8").trim().replace(/^"+|"+$/g, "");
  } catch {
    throw new AniwatchWordpressError("Invalid stream hash", 502);
  }
}

function parsePlayerPayload(html: string): PlayerPayload {
  const marker = "window.__P__=";
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new AniwatchWordpressError("Player payload not found", 502);
  }
  const scriptClose = html.indexOf("</script>", start);
  if (scriptClose < 0) {
    throw new AniwatchWordpressError("Player payload not found", 502);
  }
  const raw = html.slice(start + marker.length, scriptClose).trim().replace(/;\s*$/, "");
  return JSON.parse(raw) as PlayerPayload;
}

function parseDirectVideoSource(html: string, playerPageUrl: string): string | null {
  const sourceMatch = html.match(/<source[^>]+src="([^"]+)"/i);
  const sourceUrl = sourceMatch?.[1]?.trim();
  if (!sourceUrl) {
    return null;
  }
  return new URL(sourceUrl, playerPageUrl).toString();
}

function parseIframeSource(html: string, pageUrl: string): string | null {
  const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
  const iframeUrl = iframeMatch?.[1]?.trim();
  if (!iframeUrl) {
    return null;
  }
  return new URL(iframeUrl, pageUrl).toString();
}

async function resolvePlayableSource(
  initialUrl: string,
  referer: string,
  maxHops = 3,
): Promise<{ sourceUrl: string; tracks: PlayerPayload["tracks"] }> {
  let currentUrl = initialUrl;
  let currentReferer = referer;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const playerHtml = await fetchText(currentUrl, {
      headers: {
        Referer: currentReferer,
      },
    });

    if (/Error Code:\s*410/i.test(playerHtml) || /can'?t find the file you are looking for/i.test(playerHtml)) {
      throw new AniwatchWordpressError("Episode source was removed upstream", 404);
    }

    const player = playerHtml.includes("window.__P__") ? parsePlayerPayload(playerHtml) : undefined;
    const directSource = parseDirectVideoSource(playerHtml, currentUrl);
    const sourceUrl = player?.source || directSource;
    if (sourceUrl) {
      return {
        sourceUrl,
        tracks: player?.tracks || [],
      };
    }

    const iframeSource = parseIframeSource(playerHtml, currentUrl);
    if (!iframeSource) {
      break;
    }

    currentReferer = currentUrl;
    currentUrl = iframeSource;
  }

  throw new AniwatchWordpressError("Playable source URL not found", 502);
}

export async function getAniwatchEpisodes(animeTokenId: string) {
  const token = decodeToken<AnimeToken>(animeTokenId, "anime");
  const animePageUrl = await resolveAnimePageUrl(token);
  const context = await fetchAnimePageContext(animePageUrl);
  const payload =
    context.restWatchUrl
      ? await getWordpressWatchRest<WordpressRestResponse>(context.restWatchUrl, `episode/list/${context.animeId}`)
      : await postWordpressAjax(animePageUrl, {
        action: "hianime_episode_list",
        anime_id: context.animeId,
        nonce: context.nonce,
      });

  const episodes = parseEpisodesHtml(payload.html || "");
  return {
    totalEpisodes: episodes.length,
    episodes,
  };
}

export async function getAniwatchEpisodeServers(episodeTokenId: string) {
  const token = decodeToken<EpisodeToken>(episodeTokenId, "episode");
  const html = await fetchText(token.episodePageUrl);
  const context = extractCommentsContext(html);
  const payload = await getEpisodeServersPayload(token.episodePageUrl, context);
  const entries = parseServerEntries(payload.html || "");

  const result = {
    episodeId: episodeTokenId,
    episodeNo: token.number,
    sub: [] as Array<{ serverId: number; serverName: string }>,
    dub: [] as Array<{ serverId: number; serverName: string }>,
    raw: [] as Array<{ serverId: number; serverName: string }>,
  };

  for (const [index, entry] of entries.entries()) {
    result[entry.category].push({
      serverId: index + 1,
      serverName: normalizeServerName(entry.serverName),
    });
  }

  return result;
}

export async function getAniwatchEpisodeSources(
  episodeTokenId: string,
  server: string,
  category: "sub" | "dub" | "raw",
) {
  const token = decodeToken<EpisodeToken>(episodeTokenId, "episode");
  const html = await fetchText(token.episodePageUrl);
  const context = extractCommentsContext(html);
  const payload = await getEpisodeServersPayload(token.episodePageUrl, context);
  const entries = parseServerEntries(payload.html || "");
  const normalizedServer = normalizeServerName(server);
  const preferredEntries = entries.filter((entry) => entry.category === category);
  const orderedEntries = [
    ...preferredEntries.filter((entry) => normalizeServerName(entry.serverName) === normalizedServer),
    ...preferredEntries.filter((entry) => normalizeServerName(entry.serverName) !== normalizedServer),
    ...entries.filter((entry) => entry.category !== category),
  ].filter((entry, index, all) => all.indexOf(entry) === index);

  if (orderedEntries.length === 0) {
    throw new AniwatchWordpressError("No sources found for episode", 404);
  }

  let resolvedSource: { sourceUrl: string; tracks: PlayerPayload["tracks"] } | null = null;
  let lastError: unknown;

  for (const entry of orderedEntries) {
    try {
      const streamPageUrl = decodeHash(entry.hash);
      resolvedSource = await resolvePlayableSource(streamPageUrl, token.episodePageUrl);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!resolvedSource) {
    throw (
      lastError instanceof Error
        ? lastError
        : new AniwatchWordpressError("Playable source URL not found", 502)
    );
  }

  return {
    headers: {},
    tracks: resolvedSource.tracks || [],
    sources: [
      {
        url: resolvedSource.sourceUrl,
        isM3U8: resolvedSource.sourceUrl.includes(".m3u8"),
        quality: "auto",
      },
    ],
  };
}
