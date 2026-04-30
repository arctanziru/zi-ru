import { joinRoom } from "@/lib/room-store";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as { code?: string; displayName?: string };

  if (!payload.code || !payload.displayName) {
    return NextResponse.json({ error: "code and displayName are required" }, { status: 400 });
  }

  const joined = joinRoom(payload.code.toUpperCase(), payload.displayName);

  if (!joined) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json({
    room: {
      code: joined.room.code,
      animeId: joined.room.animeId,
      animeTitle: joined.room.animeTitle,
      episodeId: joined.room.episodeId,
      episodeNumber: joined.room.episodeNumber,
      episodeTitle: joined.room.episodeTitle,
      hostMemberId: joined.room.hostMemberId,
      members: joined.room.members,
      playback: joined.room.playback,
      videoUrl: joined.room.videoUrl,
    },
    member: joined.member,
  });
}
