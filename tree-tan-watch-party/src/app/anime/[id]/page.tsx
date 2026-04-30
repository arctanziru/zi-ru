"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { StardewJukebox } from "@/components/stardew-jukebox";

type Episode = {
  id: string;
  number: number;
  title: string;
  titleJapanese: string | null;
  aired: string | null;
  filler: boolean;
  recap: boolean;
};

type EpisodeHealth = "unknown" | "available" | "unavailable";

function describeEpisodeFailure(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("removed upstream")
    || normalized.includes("playable source url not found")
    || normalized.includes("source unavailable")
    || normalized.includes("could not be loaded")
  ) {
    return "That episode source is unavailable right now. Pick another episode.";
  }

  return message;
}

export default function AnimeSetupPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const animeId = params.id;
  const animeTitle = searchParams.get("title") ?? "Selected Anime";

  const [displayName, setDisplayName] = useState("");
  const [joiningCode, setJoiningCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodeHealth, setEpisodeHealth] = useState<Record<string, EpisodeHealth>>({});
  const [providerLabel, setProviderLabel] = useState("Auto");
  const [providerDiagnostics, setProviderDiagnostics] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadEpisodes() {
      setEpisodesLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/anime/${animeId}/episodes?title=${encodeURIComponent(animeTitle)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          episodes?: Episode[];
          provider?: { label?: string };
          diagnostics?: string[];
        };

        if (!response.ok) {
          throw new Error("Episode provider unavailable for this title");
        }

        const nextEpisodes = payload.episodes ?? [];
        setEpisodes(nextEpisodes);
        setSelectedEpisodeId(nextEpisodes[0]?.id ?? "");
        setEpisodeHealth(
          Object.fromEntries(nextEpisodes.map((episode) => [episode.id, "unknown" as EpisodeHealth])),
        );
        setProviderLabel(payload.provider?.label ?? "Auto");
        setProviderDiagnostics(payload.diagnostics ?? []);
      } catch {
        setEpisodes([]);
        setEpisodeHealth({});
        setProviderLabel("Unavailable");
        setProviderDiagnostics([]);
        setError("Could not load episode list from stream provider.");
      } finally {
        setEpisodesLoading(false);
      }
    }

    void loadEpisodes();
  }, [animeId, animeTitle]);

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!selectedEpisodeId) {
      setError("Select an episode first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId);

      if (!selectedEpisode) {
        throw new Error("Selected episode not found");
      }

      const streamResponse = await fetch("/api/anime/stream?debug=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: selectedEpisode.id }),
      });

      const streamPayload = (await streamResponse.json()) as {
        error?: string;
        videoUrl?: string;
        details?: string[];
      };

      if (!streamResponse.ok || !streamPayload.videoUrl) {
        setEpisodeHealth((current) => ({ ...current, [selectedEpisode.id]: "unavailable" }));
        const debugSnippet = (streamPayload.details ?? []).slice(0, 3).join(" | ");
        throw new Error(
          debugSnippet
            ? `${streamPayload.error ?? "Failed to resolve episode stream"} (${debugSnippet})`
            : (streamPayload.error ?? "Failed to resolve episode stream"),
        );
      }

      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animeId,
          animeTitle,
          episodeId: selectedEpisode.id,
          episodeNumber: selectedEpisode.number,
          episodeTitle: selectedEpisode.title,
          videoUrl: streamPayload.videoUrl,
          displayName,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        room?: { code: string };
        member?: { memberId: string };
      };

      if (!response.ok || !payload.room || !payload.member) {
        throw new Error(payload.error ?? "Failed to create room");
      }

      setEpisodeHealth((current) => ({ ...current, [selectedEpisode.id]: "available" }));
      router.push(`/room/${payload.room.code}?memberId=${payload.member.memberId}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? describeEpisodeFailure(createError.message)
          : "Failed to create room",
      );
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim() || !joiningCode.trim()) {
      setError("Display name and room code are required.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: joiningCode.toUpperCase(),
          displayName,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        room?: { code: string };
        member?: { memberId: string };
      };

      if (!response.ok || !payload.room || !payload.member) {
        throw new Error(payload.error ?? "Failed to join room");
      }

      router.push(`/room/${payload.room.code}?memberId=${payload.member.memberId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link className="text-sm text-(--muted) hover:underline" href="/">
        Back to search
      </Link>

      <section className="card mt-4 p-6 sm:p-8">
        <p className="section-title">Watch Setup</p>
        <h1 className="mt-3 max-w-4xl text-3xl leading-tight sm:text-4xl">{animeTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm text-(--muted) sm:text-base">
          Pick a healthy episode, then open a room or join one that is already running.
        </p>
        <div className="mt-4 max-w-xl">
          <StardewJukebox />
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <form className="card p-5 sm:p-6" onSubmit={createRoom}>
          <h2 className="text-xl">Create Room</h2>
          <div className="mt-3 grid gap-3">
            <input
              className="field-input"
              placeholder="Your display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button className="btn btn-primary h-10" disabled={loading} type="submit">
              {loading ? "Creating..." : "Create & Join"}
            </button>
          </div>
        </form>

        <form className="card p-5 sm:p-6" onSubmit={joinRoom}>
          <h2 className="text-xl">Join Existing Room</h2>
          <div className="mt-3 grid gap-3">
            <input
              className="field-input"
              placeholder="Your display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <input
              className="field-input uppercase"
              placeholder="Room code"
              value={joiningCode}
              onChange={(event) => setJoiningCode(event.target.value)}
            />
            <button className="btn btn-ghost h-10" disabled={loading} type="submit">
              {loading ? "Joining..." : "Join Room"}
            </button>
          </div>
        </form>
      </section>

      <section className="card mt-4 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl">Episodes</h2>
          <span className="chip">Provider: {providerLabel}</span>
        </div>
        {providerDiagnostics.length > 0 ? (
          <p className="mb-2 text-xs text-(--muted)">
            Fallback notes: {providerDiagnostics.slice(0, 2).join(" | ")}
          </p>
        ) : null}
        {episodesLoading ? <p className="mt-3 text-sm text-(--muted)">Loading episodes...</p> : null}
        {!episodesLoading && episodes.length === 0 ? (
          <p className="mt-3 text-sm text-(--muted)">No episodes available from the provider.</p>
        ) : null}
        {episodes.length > 0 ? (
          <ul className="mt-3 grid max-h-96 grid-cols-1 gap-2 overflow-auto pr-1 sm:grid-cols-2">
            {episodes.map((episode) => (
              <li className="card-paper px-3 py-2" key={episode.id}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    checked={selectedEpisodeId === episode.id}
                    className="mt-1"
                    disabled={episodeHealth[episode.id] === "unavailable"}
                    name="episode-select"
                    onChange={() => setSelectedEpisodeId(episode.id)}
                    type="radio"
                  />
                  <span>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          Episode {episode.number}: {episode.title}
                        </p>
                        <p className="mt-1 text-xs text-(--muted)">
                          {episode.aired ? `Aired: ${episode.aired.slice(0, 10)}` : "Aired date unknown"}
                          {episode.filler ? " • Filler" : ""}
                          {episode.recap ? " • Recap" : ""}
                        </p>
                      </div>
                      <span className={`episode-state-chip episode-state-${episodeHealth[episode.id] ?? "unknown"}`}>
                        {episodeHealth[episode.id] === "available"
                          ? "Ready"
                          : episodeHealth[episode.id] === "unavailable"
                            ? "Offline"
                            : "Check"}
                      </span>
                    </div>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {error ? <p className="mt-3 text-sm text-(--red)">{error}</p> : null}
    </div>
  );
}
