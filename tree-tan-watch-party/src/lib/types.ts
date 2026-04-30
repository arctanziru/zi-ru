export type AnimeResult = {
  id: string;
  title: string;
  image: string;
  synopsis: string;
  episodes: number | null;
  status: string;
  subtitleAvailable: boolean;
};

export type PlaybackAction =
  | "PLAY"
  | "PAUSE"
  | "SEEK"
  | "REWIND_5"
  | "REWIND_10"
  | "FORWARD_5"
  | "FORWARD_10";

export type RoomMember = {
  memberId: string;
  displayName: string;
  joinedAt: string;
};

export type PlaybackState = {
  positionSec: number;
  isPlaying: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type WatchRoom = {
  code: string;
  animeId: string;
  animeTitle: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  videoUrl: string;
  hostMemberId: string;
  createdAt: string;
  members: RoomMember[];
  playback: PlaybackState;
};
