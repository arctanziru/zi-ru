import { createRoom } from "@/lib/room-store";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    animeId?: string;
    animeTitle?: string;
    episodeId?: string;
    episodeNumber?: number;
    episodeTitle?: string;
    videoUrl?: string;
    displayName?: string;
  };

  if (
    !payload.animeId
    || !payload.animeTitle
    || !payload.episodeId
    || !payload.episodeTitle
    || !payload.videoUrl
    || !payload.displayName
  ) {
    return NextResponse.json(
      {
        error:
          "animeId, animeTitle, episodeId, episodeTitle, videoUrl, and displayName are required",
      },
      { status: 400 },
    );
  }

  const created = createRoom({
    animeId: payload.animeId,
    animeTitle: payload.animeTitle,
    episodeId: payload.episodeId,
    episodeNumber: Number.isFinite(payload.episodeNumber) ? Number(payload.episodeNumber) : 0,
    episodeTitle: payload.episodeTitle,
    videoUrl: payload.videoUrl,
    displayName: payload.displayName,
  });

  return NextResponse.json({
    room: {
      code: created.room.code,
      animeId: created.room.animeId,
      animeTitle: created.room.animeTitle,
      episodeId: created.room.episodeId,
      episodeNumber: created.room.episodeNumber,
      episodeTitle: created.room.episodeTitle,
      videoUrl: created.room.videoUrl,
      hostMemberId: created.room.hostMemberId,
      members: created.room.members,
      playback: created.room.playback,
    },
    member: created.member,
  });
}
