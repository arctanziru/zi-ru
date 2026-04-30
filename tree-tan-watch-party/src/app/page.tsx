import { AnimeSearchForm } from "@/components/anime-search-form";
import { StardewJukebox } from "@/components/stardew-jukebox";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <header className="house-card card relative w-full max-w-2xl overflow-visible px-6 pb-6 pt-16 sm:px-8 sm:pb-8 sm:pt-20">
        <div aria-hidden className="house-roof-trim" />
        <div aria-hidden className="house-window house-window-left" />
        <div aria-hidden className="house-window house-window-right" />

        <div className="relative z-10 text-center">
          <p className="section-title">Tree-Tan Watch Party</p>
          <h1 className="hero-title mx-auto mt-3 text-center">Settle in and watch together.</h1>
          <p className="hero-copy mx-auto mt-4 text-center">
            Build one quiet room, pass the code to Tree and Tan, and let the stream begin.
          </p>
        </div>

        <div className="relative z-10 mx-auto mt-6 max-w-xl">
          <AnimeSearchForm buttonLabel="Find Anime" defaultValue="frieren" placeholder="Search a series title" />
        </div>

        <div className="relative z-10 mx-auto mt-5 max-w-xl">
          <StardewJukebox />
        </div>
      </header>
    </div>
  );
}
