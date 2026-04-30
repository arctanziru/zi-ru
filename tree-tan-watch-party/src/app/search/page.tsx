import Link from "next/link";
import { AnimeSearchForm } from "@/components/anime-search-form";
import { AnimeSearchResults } from "@/components/anime-search-results";
import { searchAnime } from "@/lib/search-anime";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query ? await searchAnime(query) : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm text-(--muted) hover:underline" href="/">
          Back to home
        </Link>
        <span className="chip warm-note">Cached search results for 5 minutes</span>
      </div>

      <section className="card mb-6 p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-title">Anime Finder</p>
            <h1 className="mt-2 text-3xl">Search Results</h1>
          </div>
          <span className="chip">Search source: Jikan (MyAnimeList)</span>
        </div>
        <AnimeSearchForm buttonLabel="Search Again" defaultValue={query} />
        {query ? (
          <p className="mt-4 text-sm text-(--muted)">
            Showing matches for <span className="font-semibold text-(--foreground)">{query}</span>.
          </p>
        ) : (
          <p className="mt-4 text-sm text-(--muted)">Type a title to start browsing.</p>
        )}
      </section>

      {query && results.length === 0 ? (
        <section className="card p-6">
          <p className="section-title">No Matches Yet</p>
          <p className="mt-3 text-sm text-(--muted) sm:text-base">
            Try the English title, a shorter series name, or remove season wording.
          </p>
        </section>
      ) : null}

      {results.length > 0 ? <AnimeSearchResults results={results} /> : null}
    </div>
  );
}
