import "server-only";
import { cachedJson } from "@/lib/http";
import { MIN_LONG_HAUL_KM, POPULAR_PLACES, type LongHaulPlace } from "@/lib/longhaul";
import type { AirportRef, Transfer } from "@/lib/types";

// Airport/city/country reference data from Travelpayouts' public static files
// (no token needed), with Ryanair's traveller-friendly names layered on top
// ("Milan Bergamo" rather than "Orio al Serio International"). Gives every leg,
// whatever the provider, the same name, city, country, time zone and
// airport-to-city transfer estimate.

const TP = "https://api.travelpayouts.com/data/en";
const RYANAIR_AIRPORTS = "https://www.ryanair.com/api/views/locate/5/airports/en/active";
const DAY = 24 * 60 * 60 * 1000;

interface Coords {
  lat: number;
  lon: number;
}
interface RawAirport {
  code: string;
  name: string;
  city_code: string;
  country_code: string;
  time_zone: string;
  flightable: boolean;
  iata_type: string;
  coordinates?: Coords;
}
interface RawCity {
  code: string;
  name: string;
  country_code: string;
  coordinates?: Coords;
  has_flightable_airport?: boolean;
}
interface RawCountry {
  code: string;
  name: string;
}
interface RyanairAirport {
  code: string;
  name: string;
  city: { name: string };
}

export interface AirportInfo extends AirportRef {
  timeZone: string;
  /** City group (several airports can share one, e.g. Milan: BGY, LIN, MXP). */
  cityCode: string;
  /** City name in the reference data, used for grouping. */
  metroCity: string;
  /** Centre of the city travellers head for from this airport (e.g. Brussels for Charleroi). */
  centre?: { city: string; lat: number; lon: number };
  /** Where the airport is, for distances. */
  coords?: Coords;
}

interface Db {
  airports: Map<string, AirportInfo>;
  countries: Map<string, string>;
  /** Cities with at least one airport, by city code. */
  cities: Map<string, { code: string; name: string; countryCode: string; lat: number; lon: number }>;
}

const g = globalThis as unknown as { __ffAirportDbV6?: { at: number; db: Promise<Db> } };

async function load(): Promise<Db> {
  const [airports, cities, countries, ryanair] = await Promise.all([
    cachedJson<RawAirport[]>(`${TP}/airports.json`, undefined, DAY),
    cachedJson<RawCity[]>(`${TP}/cities.json`, undefined, DAY),
    cachedJson<RawCountry[]>(`${TP}/countries.json`, undefined, DAY),
    // Nice-to-have only: carry on with reference names if Ryanair is down.
    cachedJson<RyanairAirport[]>(RYANAIR_AIRPORTS, undefined, DAY).catch(() => [] as RyanairAirport[]),
  ]);
  const cityByCode = new Map(cities.map((c) => [c.code, c]));
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const ryanairByCode = new Map(ryanair.map((a) => [a.code, a]));

  // Cities by country + normalised name, for finding the city an airport is sold as.
  const citiesByCountry = new Map<string, RawCity[]>();
  for (const c of cities) {
    if (!c.coordinates || c.has_flightable_airport === false) continue;
    const list = citiesByCountry.get(c.country_code) ?? [];
    list.push(c);
    citiesByCountry.set(c.country_code, list);
  }

  const map = new Map<string, AirportInfo>();
  for (const a of airports) {
    if (a.iata_type !== "airport" || !a.flightable) continue;
    const metro = cityByCode.get(a.city_code);
    const fr = ryanairByCode.get(a.code);
    const name = fr?.name ?? a.name.replace(/ (International )?Airport$/, "");
    const city = fr?.city.name ?? metro?.name ?? name;
    const info: AirportInfo = {
      code: a.code,
      name,
      city,
      country: countryNames.get(a.country_code) ?? a.country_code,
      countryCode: a.country_code,
      timeZone: a.time_zone,
      cityCode: a.city_code,
      metroCity: metro?.name ?? city,
      coords: a.coordinates,
    };
    const found = a.coordinates
      ? transferFor(a.code, a.coordinates, name, city, metro, citiesByCountry.get(a.country_code) ?? [])
      : undefined;
    if (found) {
      info.transfer = found.transfer;
      info.centre = found.centre;
    }
    map.set(a.code, info);
  }
  const servedCities = new Set([...map.values()].map((a) => a.cityCode));
  const cityList: Db["cities"] = new Map();
  for (const c of cities) {
    if (!c.coordinates || !servedCities.has(c.code)) continue;
    cityList.set(c.code, { code: c.code, name: c.name, countryCode: c.country_code, lat: c.coordinates.lat, lon: c.coordinates.lon });
  }
  return { airports: map, countries: countryNames, cities: cityList };
}

function db(): Promise<Db> {
  const cached = g.__ffAirportDbV6;
  if (cached && Date.now() - cached.at < DAY) return cached.db;
  const fresh = load();
  g.__ffAirportDbV6 = { at: Date.now(), db: fresh };
  fresh.catch(() => {
    if (g.__ffAirportDbV6?.db === fresh) g.__ffAirportDbV6 = undefined;
  });
  return fresh;
}

export async function airportInfo(code: string): Promise<AirportInfo | undefined> {
  return (await db()).airports.get(code);
}

/**
 * AirportRef for a code. The reference data (with Ryanair's names) wins so the
 * same airport always looks the same whichever source priced it; provider
 * hints only fill gaps.
 */
export async function airportRef(code: string, hint?: Partial<AirportRef>): Promise<AirportRef> {
  const a = await airportInfo(code).catch(() => undefined);
  const ref: AirportRef = {
    code,
    name: a?.name ?? hint?.name ?? code,
    city: a?.city ?? hint?.city ?? code,
    country: a?.country ?? hint?.country ?? "",
    countryCode: a?.countryCode ?? hint?.countryCode ?? "",
  };
  if (a?.transfer) ref.transfer = a.transfer;
  return ref;
}

// Time zones of places people fly to from the UK for short trips.
const SHORT_HAUL_TZ = /^(Europe|Atlantic)\/|^Africa\/(Casablanca|Tunis|Algiers|Cairo)$|^Asia\/(Nicosia|Famagusta|Amman|Jerusalem|Tbilisi|Yerevan|Baku)$/;

/** Airports in Europe and nearby, for the destination picker. */
export async function shortHaulAirports(): Promise<AirportInfo[]> {
  const { airports } = await db();
  return [...airports.values()]
    .filter((a) => SHORT_HAUL_TZ.test(a.timeZone))
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
}

/** Countries that have short-haul airports, for the country filter. */
export async function shortHaulCountries(): Promise<{ code: string; name: string }[]> {
  const seen = new Map<string, string>();
  for (const a of await shortHaulAirports()) seen.set(a.countryCode, a.country);
  return [...seen].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Convert an instant to the naive local "YYYY-MM-DDTHH:MM:SS" at the airport. */
export function toLocalNaive(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// ---------------------------------------------------------------------------
// Airport -> city transfer time.

/**
 * Typical door-to-centre time by the usual fastest public option (train,
 * express bus or airport shuttle) for airports where distance alone misleads:
 * fast rail links, or remote airports sold under a big city's name.
 */
const KNOWN_MINUTES: Record<string, number> = {
  // Remote "secondary" airports
  BVA: 80, // Paris Beauvais: shuttle coach
  CRL: 55, // Brussels Charleroi: shuttle coach
  TRF: 110, // Oslo Torp: coach / train via Sandefjord
  NYO: 80, // Stockholm Skavsta: coach
  VST: 75, // Stockholm Västerås: coach
  HHN: 105, // Frankfurt Hahn: coach
  NRN: 70, // Düsseldorf Weeze: coach + train
  BGY: 50, // Milan Bergamo: coach
  MXP: 50, // Milan Malpensa: Malpensa Express
  WMI: 45, // Warsaw Modlin: coach / shuttle + train
  GRO: 75, // Barcelona Girona: coach
  REU: 90, // Barcelona Reus: coach
  TSF: 55, // Venice Treviso: coach
  CDT: 75, // Castellón (Valencia): road
  CIA: 40, // Rome Ciampino: bus + metro
  FCO: 35, // Rome Fiumicino: Leonardo Express
  SZZ: 45, // Szczecin Goleniów: bus
  KTW: 50, // Katowice: coach
  // Fast rail links (distance overstates the time)
  OSL: 20,
  ARN: 20,
  CPH: 15,
  ZRH: 12,
  GVA: 10,
  FRA: 15,
  DUS: 15,
  CGN: 15,
  AMS: 15,
  BRU: 20,
  VIE: 20,
  AGP: 15,
  KRK: 20,
  BER: 30,
  MUC: 40,
  PRG: 35,
  BUD: 40,
  ATH: 40,
};

const NORMALISE = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function km(a: Coords, b: Coords): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Which city travellers are heading for, and how long it takes to get there.
 * The headline city is a city named at the start of the airport's name when
 * that differs from its own city ("Brussels Charleroi" -> Brussels, "Oslo Torp"
 * -> Oslo), otherwise the airport's city.
 */
function transferFor(
  code: string,
  airport: Coords,
  name: string,
  city: string,
  metro: RawCity | undefined,
  countryCities: RawCity[],
): { transfer: Transfer; centre: { city: string; lat: number; lon: number } } | undefined {
  const n = NORMALISE(name);
  const byName = (cityName: string) => {
    const want = NORMALISE(cityName);
    return countryCities.find((c) => NORMALISE(c.name) === want);
  };

  let headline: RawCity | undefined;
  // "Castellon (Valencia)" style: the city in brackets is the one sold.
  const bracket = name.match(/\(([^)]+)\)/)?.[1];
  if (bracket) headline = byName(bracket);
  if (!headline) {
    const named = countryCities
      .filter((c) => c.name.length >= 4 && n.startsWith(`${NORMALISE(c.name)} `))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (named && NORMALISE(named.name) !== NORMALISE(city)) headline = named;
  }
  headline ??= byName(city) ?? metro;
  if (!headline?.coordinates) return undefined;

  const distance = km(airport, headline.coordinates);
  const known = KNOWN_MINUTES[code];
  // Rough rule for everything else: ~15 min of getting out of the airport and
  // into town, plus ~0.9 min per km. Matches typical bus/train times well.
  const minutes = known ?? Math.round((15 + distance * 0.9) / 5) * 5;
  return {
    transfer: { city: headline.name, minutes, km: Math.round(distance), estimate: known === undefined },
    centre: { city: headline.name, lat: headline.coordinates.lat, lon: headline.coordinates.lon },
  };
}

// ---------------------------------------------------------------------------
// Long-haul destinations ("Further away").

/** Where distances for "far away" are measured from: the north of England. */
const UK_REFERENCE = { lat: 53.35, lon: -2.27 };

let longHaulCache: { at: number; list: LongHaulPlace[] } | undefined;

/** Every city with an airport that's far enough away, popular places marked and tagged. */
export async function longHaulPlaces(): Promise<LongHaulPlace[]> {
  if (longHaulCache && Date.now() - longHaulCache.at < DAY) return longHaulCache.list;
  const { cities, countries } = await db();
  const popular = new Map(POPULAR_PLACES.map((p) => [p.code, p]));
  const list: LongHaulPlace[] = [];
  for (const c of cities.values()) {
    const pop = popular.get(c.code);
    if (!pop && km(UK_REFERENCE, c) < MIN_LONG_HAUL_KM) continue;
    list.push({
      code: c.code,
      name: pop?.name ?? c.name,
      country: countries.get(c.countryCode) ?? c.countryCode,
      countryCode: c.countryCode,
      lat: c.lat,
      lon: c.lon,
      ...(pop ? { popular: true, types: pop.types, ...(pop.aka ? { aka: pop.aka } : {}) } : {}),
    });
  }
  longHaulCache = { at: Date.now(), list };
  return list;
}

/** Far-away places matching a search: by city, country or code; popular ones first. */
export async function searchLongHaulPlaces(query: string, limit = 12): Promise<LongHaulPlace[]> {
  const q = NORMALISE(query.trim());
  if (q.length < 2) return [];
  const words = (s: string) => s.split(/[\s,()-]+/);
  const scored: { p: LongHaulPlace; score: number }[] = [];
  for (const p of await longHaulPlaces()) {
    const name = NORMALISE(p.name);
    const country = NORMALISE(p.country);
    let score = -1;
    if (p.code.toLowerCase() === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (words(name).some((w) => w.startsWith(q))) score = 2;
    else if (p.aka?.some((a) => NORMALISE(a).startsWith(q) || words(NORMALISE(a)).some((w) => w.startsWith(q)))) score = 2;
    else if (country.startsWith(q) || words(country).some((w) => w.startsWith(q))) score = 3;
    if (score < 0) continue;
    scored.push({ p, score: score - (p.popular ? 0.5 : 0) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((s) => s.p);
}
