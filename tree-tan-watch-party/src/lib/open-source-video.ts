export type OpenSourceVideo = {
  label: string;
  source: string;
  license: string;
};

const OPEN_SOURCE_VIDEOS: OpenSourceVideo[] = [
  {
    label: "Flower (CC0)",
    source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    license: "CC0",
  },
  {
    label: "Big Buck Bunny",
    source: "https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4",
    license: "Creative Commons Attribution 3.0",
  },
  {
    label: "Sintel Trailer",
    source: "https://media.w3.org/2010/05/sintel/trailer_hd.mp4",
    license: "Creative Commons Attribution 3.0",
  },
];

export function pickOpenSourceWatchVideo(seed: string): OpenSourceVideo {
  const normalized = seed.trim();

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }

  const videoIndex = Math.abs(hash) % OPEN_SOURCE_VIDEOS.length;
  return OPEN_SOURCE_VIDEOS[videoIndex];
}

export function getOpenSourceFallbackSources(primarySource: string): string[] {
  const fallbackSources = OPEN_SOURCE_VIDEOS.map((item) => item.source);
  return [primarySource, ...fallbackSources].filter(
    (source, index, all) => all.indexOf(source) === index,
  );
}
