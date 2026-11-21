# Cheap Escapes

Find the absolute cheapest day trips and Friday-night getaways from your local airports.

- **Anywhere cheap**: the single cheapest trip to every destination, ranked by total price.
- **Pick a destination**: the cheapest trip on every date to one place. Type an airport, city
  ("Milan" = all three Milan airports) or country ("Spain" = anywhere in Spain).
- **Near misses**: destinations whose flights just miss your times (within 3h, or at least half
  the time there you asked for), labelled with why.
- **People**: prices shown for the whole group (and per person).
- **Find a hotel** (trips with nights away): the cheapest 3★+ hotel rated 4.0+ on Google, not a
  hostel, within 2.5 km of the centre of the city the airport serves (Brussels for Charleroi).
  2 people per room. Shows flights + hotel total. Uses Google Hotels via SerpApi (1 search, cached 6h).
- **Remote airport warning**: a yellow note when the airport is more than ~30 min from the city
  it's sold as (Beauvais → Paris ~80 min, Charleroi → Brussels ~55 min).
- Trip presets: day trip, Fri night → Sat, Fri night → Sun, Fri → Sat or Sun, custom.
- Per-search time windows, minimum time at the destination, price cap, and the option
  to fly out of one home airport and back into another.

## Running

```bash
npm install
cp .env.example .env.local   # optional: add keys for more airlines
npm run dev                  # http://localhost:3000
```

## Hosting

GitHub Pages can't run this app (it only serves static files, and the app has a server part for
fetching fares and keeping API keys private). Host the GitHub repo on **Vercel** instead (free tier):

1. Sign in at [vercel.com](https://vercel.com) with GitHub and choose **Add New → Project**.
2. Import `Rocco-Langham/flight-finder`. The defaults for Next.js are right.
3. Under **Environment Variables** add `SERPAPI_KEY` (and `TRAVELPAYOUTS_TOKEN` if you have one).
4. Deploy. Every push to `main` redeploys automatically.

Anyone with the link spends your SerpApi searches, and all Ryanair lookups come from Vercel's
servers, so Ryanair may block more often than when running locally.

## Fare sources

| Source | Airlines | Key | Notes |
| --- | --- | --- | --- |
| Ryanair fare finder | Ryanair group | none | Live prices. Unofficial API, can change. |
| Travelpayouts Data API | easyJet, Jet2, most others | `TRAVELPAYOUTS_TOKEN` (free) | Prices other people saw in recent searches: can be stale or missing. Shown as "recent price". |
| Google Flights via SerpApi | all | `SERPAPI_KEY` (250 free searches/month) | Live. "Check live price" on any result (2 searches per trip), or ticked in "Pick a destination" mode (capped at 30 per search). Results cached 3h. |

easyJet and Jet2 have no public fare API (easyJet blocks automated access; Jet2 sells through
partners only), hence the aggregators.

All sources run in parallel and the cheapest fare per airport pair wins (`src/lib/providers/index.ts`).
Airport cities, countries and time zones come from Travelpayouts' free static data (`src/lib/airports.ts`).

## How it works

Every trip is built from two one-way fares:

1. For each outbound date: the cheapest fare from each home airport to every destination in the outbound time window.
2. For each destination: the cheapest fare back to any home airport, departing no earlier than
   `max(return window start, landing time + min time at destination)`.

Explore mode works in two phases:

1. **Every destination, ~2 calls each.** One shared query gives the cheapest outbound to every
   destination across the whole period. Per destination: the cheapest return across the period
   (so `cheapest out + cheapest back` is a lower bound), then the trip on the cheapest outbound
   date. Ryanair's lowest fares repeat a lot, so this often meets the bound: proven cheapest.
2. **Price calendars**, for every destination not yet proven, in parallel. Ryanair's `cheapestPerDay` gives the cheapest fare and
   its time for every day of a month on a route. Pairing each day's cheapest flights gives a
   lower bound per date; dates are checked from the lowest bound up, using the pairing directly
   when it fits your times and one exact lookup when not, until no date can beat the best trip.

If a fare source can't give a complete price calendar (e.g. cached Travelpayouts data), that
destination is flagged "Might be cheaper on other dates" (click "See every date" to check). Near misses are only shown for destinations proven to have no
fitting trip. "Pick a destination" uses the same calendars, so 6 months to one airport costs
~30–40 calls and every date is exact. The engine was checked against brute force on synthetic
timetables.

### Ryanair blocking

Ryanair blocks clients that ask too often (HTTP 403 for ~5–10 minutes). This happened twice while
developing, once after ~1,300 requests in a few seconds. The app doesn't limit how much it asks:
a long "anywhere" search can make well over 1,000 requests and may trigger a block. Once Ryanair
returns a 403, `src/lib/http.ts` stops calling it for 5 minutes (every call would fail anyway) and
searches show "Ryanair is temporarily refusing requests". Fares are cached for 30 minutes, so
repeat and overlapping searches are cheap.

### Transfer times

`src/lib/airports.ts` works out which city an airport is sold as ("Brussels Charleroi" → Brussels,
"Castellón (Valencia)" → Valencia) and uses a table of typical times for well-known cases, otherwise
`15 min + 0.9 min/km` of straight-line distance (shown as "About …").

The country filter (hide these / only these) is applied on the server, so excluded destinations
cost no lookups, and again in the browser, so changes show instantly.

| File | Purpose |
| --- | --- |
| `src/lib/search.ts` | Search engine (trip building, pruning, country filter) |
| `src/lib/providers/` | `ryanair.ts`, `travelpayouts.ts`, `serpapi.ts`, combiner in `index.ts` |
| `src/lib/types.ts` | `FareProvider` interface |
| `src/app/api/` | `search`, `airports`, `countries`, `sources` |
| `src/components/` | UI |

## Limits

- At most 190 outbound dates (just over 6 months) per search.
- Prices are per person, cheapest fare with a small under-seat bag only, direct flights only.
