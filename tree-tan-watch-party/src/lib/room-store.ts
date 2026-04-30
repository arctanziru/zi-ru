import {
  PlaybackAction,
  PlaybackState,
  RoomMember,
  WatchRoom,
} from "@/lib/types";

const ROOM_CODE_LENGTH = 6;

type RoomStore = {
  rooms: Map<string, WatchRoom>;
};

declare global {
  var __treeTanRoomStore: RoomStore | undefined;
}

function getStore(): RoomStore {
  if (!global.__treeTanRoomStore) {
    global.__treeTanRoomStore = { rooms: new Map<string, WatchRoom>() };
  }

  return global.__treeTanRoomStore;
}

function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 2 + ROOM_CODE_LENGTH).toUpperCase();
}

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function nextPosition(current: PlaybackState, action: PlaybackAction, seekTo?: number): number {
  if (action === "SEEK") {
    return Math.max(0, seekTo ?? current.positionSec);
  }

  if (action === "REWIND_5") {
    return Math.max(0, current.positionSec - 5);
  }

  if (action === "REWIND_10") {
    return Math.max(0, current.positionSec - 10);
  }

  if (action === "FORWARD_5") {
    return Math.max(0, current.positionSec + 5);
  }

  if (action === "FORWARD_10") {
    return Math.max(0, current.positionSec + 10);
  }

  return current.positionSec;
}

export function createRoom(params: {
  animeId: string;
  animeTitle: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  videoUrl: string;
  displayName: string;
}) {
  const store = getStore();

  let code = generateRoomCode();
  while (store.rooms.has(code)) {
    code = generateRoomCode();
  }

  const hostMember: RoomMember = {
    memberId: generateId(),
    displayName: params.displayName,
    joinedAt: nowISO(),
  };

  const room: WatchRoom = {
    code,
    animeId: params.animeId,
    animeTitle: params.animeTitle,
    episodeId: params.episodeId,
    episodeNumber: params.episodeNumber,
    episodeTitle: params.episodeTitle,
    videoUrl: params.videoUrl,
    hostMemberId: hostMember.memberId,
    createdAt: nowISO(),
    members: [hostMember],
    playback: {
      positionSec: 0,
      isPlaying: false,
      version: 1,
      updatedAt: nowISO(),
      updatedBy: hostMember.memberId,
    },
  };

  store.rooms.set(code, room);
  return { room, member: hostMember };
}

export function joinRoom(code: string, displayName: string) {
  const store = getStore();
  const room = store.rooms.get(code);

  if (!room) {
    return null;
  }

  const member: RoomMember = {
    memberId: generateId(),
    displayName,
    joinedAt: nowISO(),
  };

  room.members.push(member);
  return { room, member };
}

export function getRoom(code: string) {
  return getStore().rooms.get(code) ?? null;
}

export function applyPlaybackUpdate(params: {
  code: string;
  action: PlaybackAction;
  actorId: string;
  positionSec?: number;
}) {
  const room = getRoom(params.code);

  if (!room) {
    return { error: "ROOM_NOT_FOUND" as const };
  }

  if (room.hostMemberId !== params.actorId) {
    return { error: "ONLY_HOST_CAN_CONTROL" as const };
  }

  const current = room.playback;
  const positionSec = nextPosition(current, params.action, params.positionSec);

  room.playback = {
    positionSec,
    isPlaying: params.action === "PLAY" ? true : params.action === "PAUSE" ? false : current.isPlaying,
    version: current.version + 1,
    updatedAt: nowISO(),
    updatedBy: params.actorId,
  };

  return { room };
}

export function updateRoomEpisode(params: {
  code: string;
  actorId: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  videoUrl: string;
}) {
  const room = getRoom(params.code);

  if (!room) {
    return { error: "ROOM_NOT_FOUND" as const };
  }

  if (room.hostMemberId !== params.actorId) {
    return { error: "ONLY_HOST_CAN_CONTROL" as const };
  }

  room.episodeId = params.episodeId;
  room.episodeNumber = Number.isFinite(params.episodeNumber) ? params.episodeNumber : 0;
  room.episodeTitle = params.episodeTitle;
  room.videoUrl = params.videoUrl;

  const current = room.playback;
  room.playback = {
    positionSec: 0,
    isPlaying: false,
    version: current.version + 1,
    updatedAt: nowISO(),
    updatedBy: params.actorId,
  };

  return { room };
}
