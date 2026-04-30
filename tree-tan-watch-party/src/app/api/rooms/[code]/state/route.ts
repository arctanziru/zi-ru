import { applyPlaybackUpdate, getRoom } from "@/lib/room-store";
import { PlaybackAction } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

const allowedActions: PlaybackAction[] = [
  "PLAY",
  "PAUSE",
  "SEEK",
  "REWIND_5",
  "REWIND_10",
  "FORWARD_5",
  "FORWARD_10",
];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = getRoom(code.toUpperCase());

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const sinceVersionRaw = request.nextUrl.searchParams.get("sinceVersion");
  const sinceVersion = sinceVersionRaw ? Number(sinceVersionRaw) : 0;

  if (sinceVersion >= room.playback.version) {
    return NextResponse.json({
      changed: false,
      playback: room.playback,
      room: {
        hostMemberId: room.hostMemberId,
        episodeId: room.episodeId,
        episodeNumber: room.episodeNumber,
        episodeTitle: room.episodeTitle,
        videoUrl: room.videoUrl,
      },
    });
  }

  return NextResponse.json({
    changed: true,
    playback: room.playback,
    room: {
      hostMemberId: room.hostMemberId,
      episodeId: room.episodeId,
      episodeNumber: room.episodeNumber,
      episodeTitle: room.episodeTitle,
      videoUrl: room.videoUrl,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  const payload = (await request.json()) as {
    action?: PlaybackAction;
    actorId?: string;
    positionSec?: number;
  };

  if (!payload.action || !allowedActions.includes(payload.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (!payload.actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }

  const updated = applyPlaybackUpdate({
    code: code.toUpperCase(),
    action: payload.action,
    actorId: payload.actorId,
    positionSec: payload.positionSec,
  });

  if (updated.error === "ROOM_NOT_FOUND") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (updated.error === "ONLY_HOST_CAN_CONTROL") {
    return NextResponse.json({ error: "Only host can control playback" }, { status: 403 });
  }

  return NextResponse.json({ playback: updated.room.playback });
}
