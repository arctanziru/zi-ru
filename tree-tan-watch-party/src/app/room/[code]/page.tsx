"use client";

import { PlaybackAction, PlaybackState, RoomMember } from "@/lib/types";
import {
  ChevronDown,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Episode = {
  id: string;
  number: number;
  title: string;
  titleJapanese: string | null;
  aired: string | null;
  filler: boolean;
  recap: boolean;
};

type RoomResponse = {
  room: {
    code: string;
    animeId: string;
    animeTitle: string;
    episodeId: string;
    episodeNumber: number;
    episodeTitle: string;
    videoUrl: string;
    hostMemberId: string;
    members: RoomMember[];
    playback: PlaybackState;
  };
};

type RoomPatch = {
  hostMemberId?: string;
  episodeId?: string;
  episodeNumber?: number;
  episodeTitle?: string;
  videoUrl?: string;
};

type PlaybackRealtimeMessage = {
  playback: PlaybackState;
  actorId: string;
  room?: RoomPatch;
};

type EpisodeHealth = "unknown" | "available" | "unavailable";

function formatClock(secondsValue: number) {
  const clamped = Number.isFinite(secondsValue) ? Math.max(0, Math.floor(secondsValue)) : 0;
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function describeEpisodeFailure(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("removed upstream")
    || normalized.includes("error code: 410")
    || normalized.includes("could not be loaded")
    || normalized.includes("playable source url not found")
  ) {
    return "This episode source is unavailable right now.";
  }

  return message;
}

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();

  const code = params.code.toUpperCase();
  const memberId = searchParams.get("memberId") ?? "";

  const [room, setRoom] = useState<RoomResponse["room"] | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodeLoadingId, setEpisodeLoadingId] = useState("");
  const [episodeHealth, setEpisodeHealth] = useState<Record<string, EpisodeHealth>>({});
  const [status, setStatus] = useState("Connecting...");
  const [error, setError] = useState("");
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  const playerRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);
  const applyingRemote = useRef(false);
  const roomRef = useRef<RoomResponse["room"] | null>(null);
  const hlsCleanupRef = useRef<(() => void) | null>(null);
  const ablyClientRef = useRef<{ close: () => void } | null>(null);
  const ablyChannelRef = useRef<{
    publish: (name: string, data: unknown) => Promise<unknown>;
    subscribe: (name: string, listener: (message: { data?: unknown }) => void) => unknown;
    unsubscribe: (name: string) => unknown;
  } | null>(null);

  const ablyKey = process.env.NEXT_PUBLIC_ABLY_KEY?.trim() ?? "";

  const isHost = useMemo(
    () => Boolean(room?.hostMemberId && memberId && room.hostMemberId === memberId),
    [memberId, room?.hostMemberId],
  );

  const activeSource = room?.videoUrl ?? "";
  const controlsHideTimerRef = useRef<number | null>(null);

  const currentEpisodeIndex = useMemo(
    () => episodes.findIndex((episode) => episode.id === room?.episodeId),
    [episodes, room?.episodeId],
  );

  const displayTime = scrubValue ?? localTime;
  const progressPercent = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

  const applyRoomPatch = useCallback((patch: RoomPatch | undefined) => {
    if (!patch) {
      return;
    }

    const previous = roomRef.current;
    const nextVideo = patch.videoUrl;
    if (previous && nextVideo && previous.videoUrl !== nextVideo) {
      setLocalTime(0);
      setDuration(0);
      setScrubValue(null);
      setPlayerReady(false);
    }

    setRoom((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const applyPlaybackToPlayer = useCallback((nextPlayback: PlaybackState) => {
    const video = playerRef.current;
    if (!video) {
      return;
    }

    applyingRemote.current = true;

    if (Math.abs(video.currentTime - nextPlayback.positionSec) > 0.45) {
      video.currentTime = nextPlayback.positionSec;
    }

    if (nextPlayback.isPlaying) {
      void video.play().catch(() => {
        setStatus("Connected (press Play once due to browser autoplay policy)");
      });
    } else {
      video.pause();
    }

    setLocalTime(nextPlayback.positionSec);

    window.setTimeout(() => {
      applyingRemote.current = false;
    }, 100);
  }, []);

  const publishRealtime = useCallback(
    async (nextPlayback: PlaybackState, nextRoom?: RoomPatch) => {
      if (!ablyChannelRef.current) {
        return;
      }

      const payload: PlaybackRealtimeMessage = {
        playback: nextPlayback,
        actorId: memberId,
        room: nextRoom,
      };

      try {
        await ablyChannelRef.current.publish("playback", payload);
      } catch {
        setStatus("Connected (API only)");
      }
    },
    [memberId],
  );

  const sendAction = useCallback(
    async (action: PlaybackAction, positionSec?: number) => {
      if (!memberId) {
        setError("Missing memberId. Rejoin from setup page.");
        return;
      }

      const response = await fetch(`/api/rooms/${code}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, positionSec, actorId: memberId }),
      });

      const payload = (await response.json()) as { error?: string; playback?: PlaybackState };
      if (!response.ok || !payload.playback) {
        throw new Error(payload.error ?? "Failed to sync action");
      }

      setPlayback(payload.playback);
      applyPlaybackToPlayer(payload.playback);
      await publishRealtime(payload.playback);
    },
    [applyPlaybackToPlayer, code, memberId, publishRealtime],
  );

  const revealControls = useCallback(() => {
    setControlsVisible(true);

    if (controlsHideTimerRef.current) {
      window.clearTimeout(controlsHideTimerRef.current);
    }

    controlsHideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      setSpeedMenuOpen(false);
    }, 2400);
  }, []);

  const markEpisodeHealth = useCallback((episodeId: string, health: EpisodeHealth) => {
    setEpisodeHealth((current) => ({ ...current, [episodeId]: health }));
  }, []);

  const seekRelative = useCallback((deltaSeconds: number) => {
    const video = playerRef.current;
    if (!video) {
      return;
    }

    const durationSafe = Number.isFinite(video.duration) ? video.duration : duration;
    const nextPosition = Math.max(0, Math.min(durationSafe || Number.MAX_SAFE_INTEGER, video.currentTime + deltaSeconds));
    video.currentTime = nextPosition;
    setLocalTime(nextPosition);

    if (isHost) {
      void sendAction("SEEK", nextPosition);
    }
  }, [duration, isHost, sendAction]);

  async function switchEpisode(nextEpisode: Episode) {
    if (!isHost) {
      return;
    }

    if (!room || !memberId || episodeLoadingId) {
      return;
    }

    setEpisodeLoadingId(nextEpisode.id);
    setError("");

    try {
      const streamResponse = await fetch("/api/anime/stream?debug=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: nextEpisode.id }),
      });

      const streamPayload = (await streamResponse.json()) as {
        error?: string;
        videoUrl?: string;
        details?: string[];
      };

      if (!streamResponse.ok || !streamPayload.videoUrl) {
        const debugSnippet = (streamPayload.details ?? []).slice(0, 3).join(" | ");
        throw new Error(
          debugSnippet
            ? `${streamPayload.error ?? "Failed to resolve episode stream"} (${debugSnippet})`
            : (streamPayload.error ?? "Failed to resolve episode stream"),
        );
      }

      const response = await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorId: memberId,
          episodeId: nextEpisode.id,
          episodeNumber: nextEpisode.number,
          episodeTitle: nextEpisode.title,
          videoUrl: streamPayload.videoUrl,
        }),
      });

      const payload = (await response.json()) as RoomResponse & { error?: string };

      if (!response.ok || !payload.room) {
        throw new Error(payload.error ?? "Failed to update room episode");
      }

      markEpisodeHealth(nextEpisode.id, "available");
      setRoom(payload.room);
      setPlayback(payload.room.playback);
      applyPlaybackToPlayer(payload.room.playback);

      await publishRealtime(payload.room.playback, {
        hostMemberId: payload.room.hostMemberId,
        episodeId: payload.room.episodeId,
        episodeNumber: payload.room.episodeNumber,
        episodeTitle: payload.room.episodeTitle,
        videoUrl: payload.room.videoUrl,
      });
    } catch (switchError) {
      markEpisodeHealth(nextEpisode.id, "unavailable");
      setError(
        switchError instanceof Error
          ? describeEpisodeFailure(switchError.message)
          : "Failed to change episode",
      );
    } finally {
      setEpisodeLoadingId("");
    }
  }

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    async function loadRoom() {
      try {
        const response = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
        const payload = (await response.json()) as RoomResponse & { error?: string };

        if (!response.ok || !payload.room) {
          throw new Error(payload.error ?? "Room not found");
        }

        setRoom(payload.room);
        setPlayback(payload.room.playback);
        setStatus("Connected");
      } catch (loadError) {
        setStatus("Disconnected");
        setError(loadError instanceof Error ? loadError.message : "Failed to load room");
      }
    }

    void loadRoom();
  }, [code]);

  useEffect(() => {
    if (!room?.animeId || !room?.animeTitle) {
      return;
    }

    const animeId = room.animeId;
    const animeTitle = room.animeTitle;
    let active = true;

    async function loadEpisodes() {
      setEpisodesLoading(true);

      try {
        const response = await fetch(
          `/api/anime/${animeId}/episodes?title=${encodeURIComponent(animeTitle)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { episodes?: Episode[] };

        if (!response.ok) {
          throw new Error("Episode list unavailable");
        }

        if (!active) {
          return;
        }

        setEpisodes(payload.episodes ?? []);
        setEpisodeHealth(
          Object.fromEntries((payload.episodes ?? []).map((episode) => [episode.id, "unknown" as EpisodeHealth])),
        );
      } catch {
        if (!active) {
          return;
        }

        setEpisodes([]);
        setError("Could not load episode list for switching.");
      } finally {
        if (active) {
          setEpisodesLoading(false);
        }
      }
    }

    void loadEpisodes();

    return () => {
      active = false;
    };
  }, [room?.animeId, room?.animeTitle]);

  useEffect(() => {
    if (!ablyKey || !memberId) {
      setRealtimeReady(false);
      return;
    }

    let active = true;
    let onPlayback: ((message: { data?: unknown }) => void) | null = null;

    async function connectRealtime() {
      try {
        const Ably = await import("ably");
        const client = new Ably.Realtime({
          key: ablyKey,
          clientId: memberId,
        });

        const channel = client.channels.get(`watch-party:${code}`);

        onPlayback = (message) => {
          const payload = message.data as PlaybackRealtimeMessage;
          if (!payload?.playback || payload.actorId === memberId) {
            return;
          }

          setPlayback((previous) => {
            if (previous && payload.playback.version <= previous.version) {
              return previous;
            }

            applyPlaybackToPlayer(payload.playback);
            return payload.playback;
          });

          applyRoomPatch(payload.room);
          setStatus("Connected (Ably realtime)");
        };

        channel.subscribe("playback", onPlayback);

        if (!active) {
          channel.unsubscribe("playback");
          client.close();
          return;
        }

        ablyChannelRef.current = channel;
        ablyClientRef.current = client;
        setRealtimeReady(true);
        setStatus("Connected (Ably realtime)");
      } catch {
        setRealtimeReady(false);
        setStatus("Connected (API polling)");
      }
    }

    void connectRealtime();

    return () => {
      active = false;

      if (ablyChannelRef.current) {
        ablyChannelRef.current.unsubscribe("playback");
      }

      if (ablyClientRef.current) {
        ablyClientRef.current.close();
      }

      ablyChannelRef.current = null;
      ablyClientRef.current = null;
      onPlayback = null;
      setRealtimeReady(false);
    };
  }, [ablyKey, applyPlaybackToPlayer, applyRoomPatch, code, memberId]);

  useEffect(() => {
    if (!playback || realtimeReady) {
      return;
    }

    applyPlaybackToPlayer(playback);
  }, [applyPlaybackToPlayer, playback, realtimeReady]);

  useEffect(() => {
    if (!playback) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/rooms/${code}/state?sinceVersion=${playback.version}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          setStatus("Reconnecting...");
          return;
        }

        const payload = (await response.json()) as {
          changed: boolean;
          playback: PlaybackState;
          room?: RoomPatch;
        };

        if (payload.changed) {
          setPlayback(payload.playback);
          applyPlaybackToPlayer(payload.playback);
        }

        applyRoomPatch(payload.room);
        setStatus("Connected");
      } catch {
        setStatus("Reconnecting...");
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [applyPlaybackToPlayer, applyRoomPatch, code, playback]);

  useEffect(() => {
    const video = playerRef.current;
    if (!video) {
      return;
    }

    video.volume = muted ? 0 : volume;
    video.playbackRate = playbackRate;
  }, [muted, playbackRate, volume]);

  useEffect(() => {
    revealControls();
    return () => {
      if (controlsHideTimerRef.current) {
        window.clearTimeout(controlsHideTimerRef.current);
      }
    };
  }, [revealControls]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!speedMenuRef.current?.contains(event.target as Node)) {
        setSpeedMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  function onPlayerPlay() {
    if (!isHost || applyingRemote.current) {
      return;
    }

    void sendAction("PLAY");
  }

  function onPlayerPause() {
    if (!isHost || applyingRemote.current) {
      return;
    }

    void sendAction("PAUSE");
  }

  function onVideoError() {
    setPlayerReady(false);
    if (room?.episodeId) {
      markEpisodeHealth(room.episodeId, "unavailable");
    }
    setError("The current episode stream could not be loaded in the player. Try another episode.");
  }

  function commitSeek() {
    if (scrubValue === null) {
      return;
    }

    const target = Math.max(0, Math.min(duration || scrubValue, scrubValue));
    const video = playerRef.current;
    if (video) {
      video.currentTime = target;
    }

    setLocalTime(target);
    setScrubValue(null);

    if (isHost) {
      void sendAction("SEEK", target);
    }
  }

  function togglePlayback() {
    if (!isHost) {
      return;
    }

    if (playback?.isPlaying) {
      void sendAction("PAUSE");
      return;
    }

    void sendAction("PLAY");
  }

  function jumpEpisode(delta: number) {
    if (!isHost || currentEpisodeIndex < 0) {
      return;
    }

    const nextEpisode = episodes[currentEpisodeIndex + delta];
    if (!nextEpisode) {
      return;
    }

    void switchEpisode(nextEpisode);
  }

  async function toggleFullscreen() {
    const shell = playerShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await shell.requestFullscreen();
  }

  function onPlayerSurfaceDoubleClick(direction: "backward" | "forward" | "center") {
    revealControls();

    if (direction === "center") {
      void toggleFullscreen();
      return;
    }

    if (!isHost) {
      return;
    }

    seekRelative(direction === "backward" ? -10 : 10);
  }

  useEffect(() => {
    const shell = playerShellRef.current;
    if (!shell) {
      return;
    }

    const onFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement === shell);
      setIsFullscreen(fullscreen);
      setSpeedMenuOpen(false);
      if (fullscreen) {
        revealControls();
      } else {
        setControlsVisible(true);
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [revealControls]);

  useEffect(() => {
    const video = playerRef.current;
    const source = room?.videoUrl?.trim();

    hlsCleanupRef.current?.();
    hlsCleanupRef.current = null;
    setPlayerReady(false);

    if (!video || !source) {
      return;
    }

    let cancelled = false;

    const attachDirectSource = () => {
      video.src = source;
      video.load();
      setPlayerReady(true);
    };

    const attachSource = async () => {
      video.pause();
      video.removeAttribute("src");
      video.load();

      if (!source.includes(".m3u8")) {
        attachDirectSource();
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        attachDirectSource();
        return;
      }

      const hlsModule = await import("hls.js");
      if (cancelled) {
        return;
      }

      const Hls = hlsModule.default;
      if (!Hls.isSupported()) {
        setError("This browser cannot play the current stream format.");
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerReady(true);
        if (room?.episodeId) {
          markEpisodeHealth(room.episodeId, "available");
        }
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlayerReady(false);
          if (room?.episodeId) {
            markEpisodeHealth(room.episodeId, "unavailable");
          }
          setError("The current episode stream could not be loaded in the player.");
        }
      });

      hlsCleanupRef.current = () => {
        hls.destroy();
      };
    };

    void attachSource();

    return () => {
      cancelled = true;
      hlsCleanupRef.current?.();
      hlsCleanupRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [markEpisodeHealth, room?.episodeId, room?.videoUrl]);

  if (!room) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-sm">Loading room...</p>
        {error ? <p className="mt-2 text-sm text-(--red)">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn btn-ghost text-sm" href="/search">
            Back to search
          </Link>
          <Link className="btn btn-primary text-sm" href="/">
            Back to home
          </Link>
        </div>
        <span className="rounded-full border border-(--line) bg-[#fff6d8] px-3 py-1 text-xs font-semibold text-[#6f5b2f] shadow-[0_2px_0_rgba(111,91,47,0.12)] sm:text-sm">
          Status: {status}
        </span>
      </div>

      <section className="grid gap-4 xl:grid-cols-[2.2fr,1fr]">
        <div className="space-y-4">
          <div
            className={`youtube-like-panel ${isFullscreen ? "player-shell-fullscreen" : "overflow-hidden"}`}
            onMouseLeave={() => {
              if (isFullscreen) {
                setControlsVisible(false);
                setSpeedMenuOpen(false);
              }
            }}
            onMouseMove={revealControls}
            ref={playerShellRef}
          >
            <div className="player-stage aspect-video w-full bg-black">
              <video
                className="h-full w-full object-contain"
                controls={false}
                key={activeSource}
                onClick={() => {
                  revealControls();
                  if (isHost) {
                    togglePlayback();
                  }
                }}
                onDoubleClick={() => {
                  void toggleFullscreen();
                }}
                onDurationChange={() => setDuration(playerRef.current?.duration ?? 0)}
                onError={onVideoError}
                onLoadedMetadata={() => {
                  setDuration(playerRef.current?.duration ?? 0);
                  setPlayerReady(true);
                  if (room.episodeId) {
                    markEpisodeHealth(room.episodeId, "available");
                  }
                }}
                onPause={onPlayerPause}
                onPlay={onPlayerPlay}
                onTimeUpdate={() => {
                  if (scrubValue !== null) {
                    return;
                  }

                  setLocalTime(playerRef.current?.currentTime ?? 0);
                }}
                playsInline
                ref={playerRef}
              />
              <div className={`player-top-fade ${controlsVisible ? "opacity-100" : "opacity-0"}`} />
              <div className={`player-bottom-fade ${controlsVisible ? "opacity-100" : "opacity-0"}`} />
              <div className="absolute inset-0 grid grid-cols-3">
                <button
                  aria-label="Seek backward 10 seconds"
                  className="player-tap-zone"
                  disabled={!isHost}
                  onDoubleClick={() => onPlayerSurfaceDoubleClick("backward")}
                  onMouseMove={revealControls}
                  type="button"
                >
                  <span className="player-tap-hint">-10s</span>
                </button>
                <button
                  aria-label="Toggle fullscreen"
                  className="player-tap-zone"
                  onDoubleClick={() => onPlayerSurfaceDoubleClick("center")}
                  onMouseMove={revealControls}
                  type="button"
                />
                <button
                  aria-label="Seek forward 10 seconds"
                  className="player-tap-zone"
                  disabled={!isHost}
                  onDoubleClick={() => onPlayerSurfaceDoubleClick("forward")}
                  onMouseMove={revealControls}
                  type="button"
                >
                  <span className="player-tap-hint">+10s</span>
                </button>
              </div>
              <div className={`player-header absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 text-white ${controlsVisible ? "opacity-100" : "opacity-0"}`}>
                <div>
                  <p className="player-surface-title max-w-[70vw] truncate text-sm sm:text-base">
                    Episode {room.episodeNumber}: {room.episodeTitle}
                  </p>
                </div>
                <span className="player-badge">
                  {playback?.isPlaying ? "Playing" : "Paused"}
                </span>
              </div>
              <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${controlsVisible ? "opacity-100" : "opacity-0"}`}>
                <button
                  className="player-center-button"
                  disabled={!isHost || !playerReady}
                  onClick={togglePlayback}
                  aria-label={playback?.isPlaying ? "Pause video" : "Play video"}
                  type="button"
                >
                  {playback?.isPlaying ? <Pause className="mx-auto h-7 w-7" /> : <Play className="mx-auto h-7 w-7 fill-current" />}
                </button>
              </div>
            </div>

            <div
              className={`player-controls-shell border-t border-[#56381e] bg-[#2d1d11] p-3 sm:p-4 transition-[opacity,transform] ${isFullscreen ? "player-controls-shell-fullscreen absolute inset-x-0 bottom-0 z-20 border-t-0" : ""} ${controlsVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0"}`}
            >
              <input
                className="range-slider"
                disabled={!isHost}
                max={Math.max(duration, 1)}
                min={0}
                onBlur={commitSeek}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setScrubValue(nextValue);
                  setLocalTime(nextValue);
                }}
                onPointerUp={commitSeek}
                step={0.25}
                style={{ "--progress": `${progressPercent}%` } as CSSProperties}
                type="range"
                value={displayTime}
              />

              <div className="player-control-bar mt-3">
                <div className="player-control-group">
                  <button
                    aria-label={playback?.isPlaying ? "Pause video" : "Play video"}
                    className="player-control player-control-primary player-control-icon"
                    disabled={!isHost || !playerReady}
                    onClick={togglePlayback}
                    type="button"
                  >
                    {playback?.isPlaying ? <Pause className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px] fill-current" />}
                  </button>
                  <button
                    aria-label="Seek backward 10 seconds"
                    className="player-control player-control-icon"
                    disabled={!isHost || !playerReady}
                    onClick={() => seekRelative(-10)}
                    type="button"
                  >
                    <SkipBack className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    aria-label="Seek forward 10 seconds"
                    className="player-control player-control-icon"
                    disabled={!isHost || !playerReady}
                    onClick={() => seekRelative(10)}
                    type="button"
                  >
                    <SkipForward className="h-[18px] w-[18px]" />
                  </button>
                  <div className="player-control-group min-w-0">
                    <button
                      aria-label={muted ? "Unmute player" : "Mute player"}
                      className="player-control player-control-icon"
                      onClick={() => setMuted((current) => !current)}
                      type="button"
                    >
                      {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
                    </button>
                    <input
                      aria-label="Volume"
                      className="range-slider w-24 sm:w-28"
                      max={1}
                      min={0}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setVolume(next);
                        setMuted(next <= 0.01);
                      }}
                      step={0.01}
                      style={{ "--progress": `${Math.max(0, Math.min(100, volume * 100))}%` } as CSSProperties}
                      type="range"
                      value={muted ? 0 : volume}
                    />
                  </div>
                  <span className="player-time min-w-[8.25rem]">
                    {formatClock(displayTime)} / {formatClock(duration)}
                  </span>
                </div>

                <div className="player-control-group player-control-group-right">
                  <div className="player-speed-menu" ref={speedMenuRef}>
                    <button
                      aria-expanded={speedMenuOpen}
                      aria-haspopup="true"
                      className="player-control player-speed-trigger"
                      onClick={() => {
                        revealControls();
                        setSpeedMenuOpen((current) => !current);
                      }}
                      type="button"
                    >
                      <span className="player-control-label">{playbackRate === 1 ? "Normal" : `${playbackRate}x`}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${speedMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {speedMenuOpen ? (
                      <div className="player-speed-popover">
                        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            className={`player-speed-option ${playbackRate === rate ? "player-speed-option-active" : ""}`}
                            key={rate}
                            onClick={() => {
                              setPlaybackRate(rate);
                              setSpeedMenuOpen(false);
                              revealControls();
                            }}
                            type="button"
                          >
                            {rate === 1 ? "Normal" : `${rate}x`}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    className="player-control player-control-icon"
                    onClick={() => {
                      void toggleFullscreen();
                    }}
                    type="button"
                  >
                    {isFullscreen ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <p className="section-title">Now Playing</p>
            <h1 className="mt-1 text-xl sm:text-2xl">{room.animeTitle}</h1>
            <p className="mt-2 text-sm text-(--muted)">
              Episode {room.episodeNumber}: {room.episodeTitle}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost text-xs disabled:opacity-50"
                disabled={!isHost || currentEpisodeIndex <= 0 || Boolean(episodeLoadingId)}
                onClick={() => jumpEpisode(-1)}
                type="button"
              >
                Previous Episode
              </button>
              <button
                className="btn btn-primary text-xs disabled:opacity-50"
                disabled={
                  !isHost
                  || currentEpisodeIndex < 0
                  || currentEpisodeIndex >= episodes.length - 1
                  || Boolean(episodeLoadingId)
                }
                onClick={() => jumpEpisode(1)}
                type="button"
              >
                Next Episode
              </button>
              <span className="text-xs text-(--muted)">
                {isHost ? "Host controls sync for everyone." : "Viewer mode, host controls the room."}
              </span>
            </div>
            {room.episodeId && episodeHealth[room.episodeId] === "unavailable" ? (
              <p className="mt-3 rounded-xl bg-[#f5d7cf] px-3 py-2 text-sm text-(--red)">
                This episode source is unavailable right now. Switch to another episode.
              </p>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <h2 className="text-lg font-bold">Episodes</h2>
            {episodesLoading ? <p className="mt-3 text-sm text-(--muted)">Loading episodes...</p> : null}
            {!episodesLoading && episodes.length === 0 ? (
              <p className="mt-3 text-sm text-(--muted)">No episodes available.</p>
            ) : null}
            <ul className="mt-3 max-h-[24rem] space-y-2 overflow-auto pr-1">
              {episodes.map((episode) => {
                const active = room.episodeId === episode.id;
                const loading = episodeLoadingId === episode.id;
                const health = episodeHealth[episode.id] ?? "unknown";
                const unavailable = health === "unavailable";

                return (
                  <li key={episode.id}>
                    <button
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-(--wood-dark) bg-[#f6d89f] text-[#4f3116]"
                          : unavailable
                            ? "border-[#c48a73] bg-[#fff3ed] text-[#7b4637]"
                            : "border-(--line) bg-[#fffdf2] text-(--foreground) hover:bg-[#fdf1d7]"
                      } disabled:opacity-60`}
                      disabled={!isHost || loading || Boolean(episodeLoadingId) || unavailable}
                      onClick={() => {
                        void switchEpisode(episode);
                      }}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            Episode {episode.number}: {episode.title}
                          </p>
                          <p className="mt-1 text-xs text-(--muted)">
                            {loading
                              ? "Switching stream..."
                              : unavailable
                                ? "Source unavailable"
                                : active
                                  ? "Current episode"
                                  : "Click to switch"}
                          </p>
                        </div>
                        <span className={`episode-state-chip episode-state-${health}`}>
                          {health === "available" ? "Ready" : health === "unavailable" ? "Offline" : "Check"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card p-4">
            <h2 className="text-lg font-bold">Participants</h2>
            <ul className="mt-3 space-y-2">
              {room.members.map((member) => (
                <li className="card-paper px-3 py-2 text-sm" key={member.memberId}>
                  {member.displayName}
                  {member.memberId === room.hostMemberId ? " (Host)" : ""}
                </li>
              ))}
            </ul>
          </div>

          {error ? <p className="rounded-xl bg-[#f5d7cf] px-3 py-2 text-sm text-(--red)">{error}</p> : null}
        </aside>
      </section>
    </div>
  );
}
