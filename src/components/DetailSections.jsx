import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tmdbFetch } from "../utils/api";
import { isRestricted } from "../utils/ageRating";
import { getRatingForItem, useRatings } from "../utils/useRatings";
import MediaCard from "./MediaCard";
import { PersonCard, dedupeById, getDirectors, getWriters, normalizeCastPerson } from "./CastModal";

const CAST_LIMIT = 12;
const MORE_LIMIT = 12;

// Top-billed cast under the title; "See all" opens the full cast list.
export function CastStrip({ cast, onShowAll }) {
  const { t } = useTranslation();
  const people = useMemo(() => dedupeById(cast.map(normalizeCastPerson)).slice(0, CAST_LIMIT), [cast]);
  if (!people.length) return null;
  return (
    <section className="section detail-cast">
      <div className="detail-section-head">
        <div className="section-title">{t("detail.cast")}</div>
        {cast.length > CAST_LIMIT && <button type="button" className="btn btn-ghost btn--sm" onClick={onShowAll}>
          {t("detail.seeAll")}
        </button>}
      </div>
      <div className="scroll-row detail-cast-row">
        {people.map((person) => <PersonCard key={person.id} person={person} />)}
      </div>
    </section>
  );
}

// TMDB recommendations for this title (or similar titles when there are none),
// filtered by the profile's age rating like the home rows.
export function MoreLikeThis({ type, id, apiKey, onSelect, progress, watched, onMarkWatched, onMarkUnwatched }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  useEffect(() => {
    let active = true;
    setItems([]);
    if (!apiKey || !id) return undefined;
    const load = (kind) => tmdbFetch(`/${type}/${id}/${kind}`, apiKey).then((data) => data?.results || []);
    load("recommendations")
      .then((results) => results.length ? results : load("similar"))
      .then((results) => {
        if (!active) return;
        setItems(results.filter((entry) => entry.poster_path).slice(0, MORE_LIMIT)
          .map((entry) => ({ ...entry, media_type: type })));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [type, id, apiKey]);

  const { ratingsMap, ageLimitSetting } = useRatings(items);
  const shown = useMemo(
    () => items.filter((entry) => !isRestricted(getRatingForItem(entry, ratingsMap).minAge, ageLimitSetting)),
    [items, ratingsMap, ageLimitSetting],
  );
  if (!shown.length || !onSelect) return null;
  return (
    <section className="section">
      <div className="section-title">{t("detail.moreLikeThis")}</div>
      <div className="scroll-row">
        {shown.map((entry) => {
          const key = `${type}_${entry.id}`;
          return <MediaCard key={entry.id} item={entry} onClick={() => onSelect(entry)} progress={progress?.[key] || 0}
            watched={watched} onMarkWatched={onMarkWatched} onMarkUnwatched={onMarkUnwatched} />;
        })}
      </div>
    </section>
  );
}

const names = (people, limit = 3) => people.slice(0, limit).map((person) => person.name).join(", ");

// Facts about the title, from data the page already loaded. Rows without data are left out.
export function DetailsPanel({ type, details, crew, creators = [] }) {
  const { t, i18n } = useTranslation();
  const rows = useMemo(() => {
    if (!details) return [];
    // TMDB dates have no time; format them in UTC so the day doesn't shift.
    const date = (value) => value ? new Date(value).toLocaleDateString(i18n.language, { dateStyle: "long", timeZone: "UTC" }) : null;
    const money = (value) => value > 0
      ? new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value)
      : null;
    let language = null;
    try {
      language = details.original_language
        ? new Intl.DisplayNames([i18n.language], { type: "language" }).of(details.original_language)
        : null;
    } catch { language = details.original_language || null; }
    const originalTitle = type === "movie" ? details.original_title : details.original_name;
    const shownTitle = type === "movie" ? details.title : details.name;
    const directors = getDirectors(crew || []);
    const writers = getWriters(crew || []);
    return [
      type === "movie"
        ? [directors.length > 1 ? "directors" : "director", names(directors)]
        : ["createdBy", names(creators)],
      ["writers", type === "movie" ? names(writers) : null],
      type === "movie" ? ["releaseDate", date(details.release_date)] : ["firstAired", date(details.first_air_date)],
      ["lastAired", type === "tv" && details.status === "Ended" ? date(details.last_air_date) : null],
      ["seasons", type === "tv" && details.number_of_seasons
        ? t("detail.seasonsValue", { seasons: details.number_of_seasons, episodes: details.number_of_episodes || 0 })
        : null],
      ["networks", type === "tv" ? names(details.networks || []) : null],
      ["studios", names(details.production_companies || [])],
      ["originalTitle", originalTitle && originalTitle !== shownTitle ? originalTitle : null],
      ["originalLanguage", language],
      ["budget", type === "movie" ? money(details.budget) : null],
      ["revenue", type === "movie" ? money(details.revenue) : null],
      ["status", details.status && !["Released", "Ended"].includes(details.status) ? details.status : null],
    ].filter(([, value]) => value);
  }, [type, details, crew, creators, i18n.language, t]);
  if (!rows.length) return null;
  return (
    <section className="section">
      <div className="section-title">{t("detail.details")}</div>
      {details.tagline && <p className="detail-tagline">“{details.tagline}”</p>}
      <dl className="detail-facts">
        {rows.map(([key, value]) => <div key={key} className="detail-fact">
          <dt>{t("detail.fields." + key)}</dt>
          <dd>{value}</dd>
        </div>)}
      </dl>
    </section>
  );
}
