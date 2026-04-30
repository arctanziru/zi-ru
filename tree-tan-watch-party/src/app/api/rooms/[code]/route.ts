import { getRoom, updateRoomEpisode } from "@/lib/room-store";
import { NextRequest, NextResponse } from "next/server";

function roomResponse(room: NonNullable<ReturnType<typeof getRoom>>) {
  return {
    code: room.code,
    animeId: room.animeId,
    animeTitle: room.animeTitle,
    episodeId: room.episodeId,
    episodeNumber: room.episodeNumber,
    episodeTitle: room.episodeTitle,
    videoUrl: room.videoUrl,
    hostMemberId: room.hostMemberId,
    members: room.members,
    playback: room.playback,
  };
}

export async function GET(
  _: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = getRoom(code.toUpperCase());

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json({
    room: roomResponse(room),
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const payload = (await request.json()) as {
    actorId?: string;
    episodeId?: string;
    episodeNumber?: number;
    episodeTitle?: string;
    videoUrl?: string;
  };

  if (!payload.actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }

  if (!payload.episodeId || !payload.episodeTitle || !payload.videoUrl) {
    return NextResponse.json(
      { error: "episodeId, episodeTitle, and videoUrl are required" },
      { status: 400 },
    );
  }

  const updated = updateRoomEpisode({
    code: code.toUpperCase(),
    actorId: payload.actorId,
    episodeId: payload.episodeId,
    episodeNumber: Number.isFinite(payload.episodeNumber) ? Number(payload.episodeNumber) : 0,
    episodeTitle: payload.episodeTitle,
    videoUrl: payload.videoUrl,
  });

  if (updated.error === "ROOM_NOT_FOUND") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (updated.error === "ONLY_HOST_CAN_CONTROL") {
    return NextResponse.json({ error: "Only host can change episode" }, { status: 403 });
  }

  return NextResponse.json({
    room: roomResponse(updated.room),
  });
}
