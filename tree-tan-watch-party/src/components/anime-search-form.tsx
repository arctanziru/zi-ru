"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type AnimeSearchFormProps = {
  defaultValue?: string;
  buttonLabel?: string;
  placeholder?: string;
};

export function AnimeSearchForm({
  defaultValue = "",
  buttonLabel = "Search",
  placeholder = "Search anime title",
}: AnimeSearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    router.push(`/search?q=${encodeURIComponent(normalized)}`);
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
      <input
        className="field-input flex-1"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        value={query}
      />
      <button className="btn btn-primary h-11" type="submit">
        {buttonLabel}
      </button>
    </form>
  );
}
