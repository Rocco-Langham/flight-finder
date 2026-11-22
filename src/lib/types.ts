/** "HH:MM", 24h, local time at the departure airport. */
export type TimeOfDay = string;

export interface TimeWindow {
  from: TimeOfDay;
  to: TimeOfDay;
}

export interface AirportRef {
  code: string;
  name: string;
  city: string;
  country: string;
  /** ISO 3166 alpha-2, e.g. "ES". */
  countryCode: string;
  /** Getting from this airport to the city it serves. */
  transfer?: Transfer;
}

export interface Transfer {
  /** The city travellers are heading for, e.g. "Paris" for Beauvais. */
  city: string;
  /** Typical minutes by the usual fastest public option. */
  minutes: number;
  /** Straight-line distance. */
  km: number;
  /** True if worked out from distance rather than a known figure. */
  estimate: boolean;
}

/** A single one-way flight with its fare. Times are local at each airport (no offset). */
export interface Leg {
  provider: ProviderId;
  /** "live" = priced just now; "cached" = seen in someone's recent search, may have changed. */
  freshness: "live" | "cached";
  airline: string;
  flightNumber: string;
  from: AirportRef;
  to: AirportRef;
  depart: string; // "YYYY-MM-DDTHH:MM:SS" local
  arrive: string; // "YYYY-MM-DDTHH:MM:SS" local
  price: number;
  currency: string;
  bookingUrl: string;
}

export interface Trip {
  destination: AirportRef;
  out: Leg;
  back: Leg;
  total: number;
  currency: string;
  nights: number;
  /** Hours between landing and the return flight departing. */
  hoursAtDestination: number;
  /** Near misses only: how this trip breaks the requested times. */
  misses?: string[];
  /** Explore: the search ran out of budget before proving no other date is cheaper. */
  maybeCheaper?: boolean;
}

export type SearchMode = "explore" | "route";

export interface SearchRequest {
  mode: SearchMode;
  /** Home airports. Outbound can leave from any; return can land at any (if mixAirports). */
  origins: string[];
  /** Route mode: destination airport(s), e.g. all of Milan's. */
  destinations?: string[];
  /** Inclusive range of outbound dates, "YYYY-MM-DD". */
  dateFrom: string;
  dateTo: string;
  /** Allowed weekdays for the outbound flight, 0 = Sunday ... 6 = Saturday. */
  outDays: number[];
  /** Allowed nights away, e.g. [0] for a day trip, [1, 2] for Fri -> Sat/Sun. */
  nights: number[];
  outWindow: TimeWindow;
  returnWindow: TimeWindow;
  /** Minimum hours on the ground between landing and the return departing. */
  minHoursAtDestination: number;
  maxPrice?: number;
  /** Allow returning to a different home airport than you left from. */
  mixAirports: boolean;
  /** Hide these destination countries, or show only these. */
  countryFilter?: CountryFilter;
  /** Route mode only: also ask Google Flights (SerpApi) for live prices. */
  liveCheck?: boolean;
}

export interface CountryFilter {
  mode: "exclude" | "include";
  /** ISO 3166 alpha-2 codes. */
  codes: string[];
}

export type ProviderId = "ryanair" | "travelpayouts" | "serpapi";

export interface SourceStatus {
  id: ProviderId;
  name: string;
  enabled: boolean;
  note: string;
}

export interface SearchResponse {
  mode: SearchMode;
  currency: string;
  /** Explore: best trip per destination. Route: best trip per outbound date. */
  trips: Trip[];
  /** Explore: destinations whose flights just miss the requested times, with why. */
  nearMisses: Trip[];
  stats: {
    upstreamCalls: number;
    cacheHits: number;
    ms: number;
    outboundDates: number;
    truncated: boolean;
    /** Google Flights searches used by this search (each uses SerpApi allowance unless cached). */
    serpapiCalls: number;
  };
  warnings: string[];
}

/**
 * One-way fare query. A provider returns the cheapest direct fare for each
 * (departure airport, arrival airport) pair departing inside the window.
 */
export interface OneWayQuery {
  /** Departure airports (any of). */
  from: string[];
  /** Arrival airports (any of). Omit for "anywhere". */
  to?: string[];
  dateFrom: string;
  dateTo: string;
  window: TimeWindow;
}

export interface OneWayResult {
  legs: Leg[];
  /**
   * False if the provider may have missed fares (results cut off, or it can't
   * answer this kind of query). The engine then won't use the result as a
   * lower bound for pruning.
   */
  complete: boolean;
}

export interface FareProvider {
  id: ProviderId;
  name: string;
  cheapestOneWay(q: OneWayQuery): Promise<OneWayResult>;
  /**
   * The cheapest fare on each day of a month on one route, at any time of day.
   * Optional: providers without it can't take part in calendar searches.
   */
  calendar?(from: string, to: string, month: string): Promise<CalendarResult>;
}

export interface CalendarResult {
  /** At most one leg per day: that day's cheapest. */
  legs: Leg[];
  /** False if days may be missing or not truly the cheapest. */
  complete: boolean;
}

/** "Check live price" request: one trip plus the rules it was found under. */
export interface LiveCheckRequest {
  out: { from: string; to: string; depart: string; flightNumber: string };
  back: { from: string; to: string; depart: string; flightNumber: string };
  origins: string[];
  outWindow: TimeWindow;
  returnWindow: TimeWindow;
  minHoursAtDestination: number;
  mixAirports: boolean;
}

export interface LiveCheckResponse {
  /** The same flights on Google Flights, if found. */
  sameOut?: Leg;
  sameBack?: Leg;
  sameTotal?: number;
  /** Cheapest direct trip Google has on these dates that fits the rules. */
  best?: { out: Leg; back: Leg; total: number; hoursAtDestination: number };
  /** SerpApi searches left this month, if the account says. */
  searchesLeft?: number;
  checkedAt: string;
}

/** "Find a hotel" request: where and when, and for how many people. */
export interface HotelRequest {
  /** Destination airport; the hotel is searched in the city it serves. */
  airport: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  people: number;
}

export interface HotelOption {
  name: string;
  stars?: number;
  /** Google rating out of 5. */
  rating?: number;
  reviews?: number;
  /** Google's location score out of 5 (transport, sights, food nearby). */
  locationRating?: number;
  /** Straight-line distance to the city centre. */
  kmFromCentre?: number;
  /** A nearby place and how long it takes to get there, e.g. "Busáras, 2 min walk". */
  nearby?: string;
  /** Whole stay, one room. */
  pricePerRoom: number;
  link?: string;
}

export interface HotelResponse {
  city: string;
  nights: number;
  rooms: number;
  people: number;
  /** Cheapest decent, well-located hotel; whole stay, all rooms. */
  best?: HotelOption & { total: number };
  /** The next cheapest that also qualify. */
  alternatives: (HotelOption & { total: number })[];
  /** Google Hotels search for the same city and dates. */
  searchUrl: string;
}

// ---------------------------------------------------------------------------
// "Further away": long-haul holidays (round trips, connections allowed).

/** A stretch of dates the whole trip must fit inside: leave on/after `from`, back by `to`. */
export interface DateWindow {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** E.g. "Summer holidays", shown on results. */
  label?: string;
}

export interface HolidayRequest {
  origins: string[];
  /** City or airport codes. Empty = anywhere far away. */
  destinations: string[];
  windows: DateWindow[];
  minNights: number;
  maxNights: number;
  /** Most stops allowed each way: 0 = direct only. */
  maxStops: number;
  maxPrice?: number;
}

export interface HolidayTrip {
  destination: AirportRef;
  from: AirportRef;
  /** Naive local "YYYY-MM-DDTHH:MM" departure times. */
  depart: string;
  returnDepart: string;
  /** Naive local landing times (from journey length), if known. */
  arrive?: string;
  returnArrive?: string;
  nights: number;
  /** Return fare per person. */
  price: number;
  currency: string;
  stopsOut: number;
  stopsBack: number;
  /** Total journey minutes each way, if known. */
  minutesOut?: number;
  minutesBack?: number;
  /** Airline of the first flight (connections may use others). */
  airline: string;
  /** First flight's number, e.g. "QR22". */
  flightNumber?: string;
  /** The travel agent or airline selling this fare, e.g. "Kiwi.com". */
  soldBy?: string;
  /** Which date window it fits, e.g. "Summer holidays". */
  window?: string;
  /** The exact fare on Aviasales (where it was found). */
  fareUrl?: string;
  /** Same trip on Google Flights, to compare and book. */
  googleUrl: string;
}

export interface HolidayResponse {
  /** Anywhere: cheapest per destination. Specific places: cheapest per destination and date. */
  trips: HolidayTrip[];
  warnings: string[];
  stats: { upstreamCalls: number; cacheHits: number; ms: number };
}

/** "Flight details" for a Further-away trip: every flight and stop, from Google Flights. */
export interface HolidayDetailsRequest {
  from: string;
  to: string;
  /** Naive local "YYYY-MM-DDTHH:MM". */
  depart: string;
  returnDepart: string;
  stopsOut: number;
  stopsBack: number;
}

export interface FlightSegment {
  from: { code: string; name: string };
  to: { code: string; name: string };
  /** Naive local "YYYY-MM-DDTHH:MM". */
  depart: string;
  arrive: string;
  minutes?: number;
  airline: string;
  flightNumber: string;
  plane?: string;
  overnight?: boolean;
}

export interface Layover {
  code: string;
  name: string;
  minutes: number;
  overnight?: boolean;
}

export interface Journey {
  segments: FlightSegment[];
  layovers: Layover[];
  totalMinutes?: number;
  /** False when Google doesn't list this exact trip and this is its closest one. */
  exact: boolean;
}

export interface HolidayDetailsResponse {
  out?: Journey;
  back?: Journey;
  /** Google's price for the return trip shown, per person. */
  price?: number;
  /** Shared SerpApi searches left this month, if known. */
  searchesLeft?: number;
}
