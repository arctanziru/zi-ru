import Image from "next/image";
import Link from "next/link";
import { AnimeResult } from "@/lib/types";

type AnimeSearchResultsProps = {
  results: AnimeResult[];
};

export function AnimeSearchResults({ results }: AnimeSearchResultsProps) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {results.map((anime) => (
        <article className="card overflow-hidden" key={anime.id}>
          <Image
            alt={anime.title}
            className="h-56 w-full object-cover"
            height={800}
            src={anime.image || "https://placehold.co/600x800?text=Anime"}
            unoptimized
            width={600}
          />
          <div className="p-4">
            <h2 className="line-clamp-2 text-xl leading-tight">{anime.title}</h2>
            <p className="mt-2 text-xs text-(--muted)">
              {anime.episodes ? `${anime.episodes} eps` : "Unknown episodes"} • {anime.status}
            </p>
            <p className="mt-2 line-clamp-3 text-sm text-(--muted)">{anime.synopsis}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="chip">
                {anime.subtitleAvailable ? "ID subtitle likely" : "Subtitle unknown"}
              </span>
              <Link
                className="btn btn-primary text-sm"
                href={`/anime/${anime.id}?title=${encodeURIComponent(anime.title)}`}
              >
                Open Watch Setup
              </Link>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
