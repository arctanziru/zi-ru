import { AnimeResult } from "@/lib/types";
import { searchAnime } from "@/lib/search-anime";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter q" }, { status: 400 });
  }

  try {
    const data: AnimeResult[] = await searchAnime(query);

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Anime provider unavailable" }, { status: 502 });
  }
}
