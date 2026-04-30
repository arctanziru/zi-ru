"use client";

import { useEffect, useRef, useState } from "react";

const SOUNDTRACK_PATH = "/stardew-ost.mp3";

export function StardewJukebox() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(true);

  async function togglePlayback() {
    const player = audioRef.current;
    if (!player) {
      return;
    }

    if (player.paused) {
      try {
        await player.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
      return;
    }

    player.pause();
    setPlaying(false);
  }

  useEffect(() => {
    const player = audioRef.current;
    if (!player) {
      return;
    }

    player.volume = 0.42;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    void player.play().catch(() => {
      setPlaying(false);
    });

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, []);

  return (
    <>
      <button
        className={`btn ${playing ? "btn-danger" : "btn-ghost"} text-xs`}
        onClick={() => {
          void togglePlayback();
        }}
        type="button"
      >
        {playing ? "Stop Sound" : "Play Sound"}
      </button>
      <audio autoPlay loop preload="auto" ref={audioRef} src={SOUNDTRACK_PATH} />
    </>
  );
}
