// Long-haul destinations for "Further away": popular places from the UK, tagged
// by the kind of holiday they suit. Codes are city codes (all of a city's
// airports) as Travelpayouts uses them. Shared by the form and the search.

export type HolidayType = "beach" | "city" | "culture" | "nature" | "theme" | "ski";

export const HOLIDAY_TYPES: { id: HolidayType; label: string; icon: string }[] = [
  { id: "beach", label: "Beach & islands", icon: "🏝️" },
  { id: "city", label: "City break", icon: "🏙️" },
  { id: "culture", label: "Culture & history", icon: "🏛️" },
  { id: "nature", label: "Nature & wildlife", icon: "🦁" },
  { id: "theme", label: "Theme parks", icon: "🎢" },
  { id: "ski", label: "Skiing", icon: "⛷️" },
];

export interface PopularPlace {
  code: string;
  name: string;
  types: HolidayType[];
  /** Asked about one by one in "Anywhere far away" searches. */
  core?: boolean;
  /** Other names people search for, e.g. Kyoto for Osaka (no airport of its own). */
  aka?: string[];
}

export const POPULAR_PLACES: PopularPlace[] = [
  // East Asia
  { code: "TYO", name: "Tokyo", types: ["city", "culture", "theme"], core: true },
  { code: "OSA", name: "Osaka", types: ["city", "culture", "theme"], core: true, aka: ["Kyoto", "Nara"] },
  { code: "SPK", name: "Sapporo", types: ["ski", "nature"] },
  { code: "OKA", name: "Okinawa", types: ["beach"] },
  { code: "SEL", name: "Seoul", types: ["city", "culture"], core: true },
  { code: "HKG", name: "Hong Kong", types: ["city", "theme"], core: true },
  { code: "TPE", name: "Taipei", types: ["city", "culture"] },
  // South-East Asia
  { code: "BKK", name: "Bangkok", types: ["city", "culture"], core: true },
  { code: "HKT", name: "Phuket", types: ["beach"], core: true },
  { code: "USM", name: "Koh Samui", types: ["beach"] },
  { code: "KBV", name: "Krabi", types: ["beach", "nature"] },
  { code: "CNX", name: "Chiang Mai", types: ["culture", "nature"] },
  { code: "SIN", name: "Singapore", types: ["city", "theme"], core: true },
  { code: "KUL", name: "Kuala Lumpur", types: ["city"], core: true },
  { code: "LGK", name: "Langkawi", types: ["beach", "nature"] },
  { code: "DPS", name: "Bali", types: ["beach", "culture", "nature"], core: true, aka: ["Denpasar", "Ubud"] },
  { code: "SGN", name: "Ho Chi Minh City", types: ["city", "culture"], core: true },
  { code: "HAN", name: "Hanoi", types: ["city", "culture", "nature"], core: true },
  { code: "SAI", name: "Siem Reap", types: ["culture"], aka: ["Angkor Wat", "Angkor"] },
  { code: "MNL", name: "Manila", types: ["city"] },
  { code: "CEB", name: "Cebu", types: ["beach"] },
  // South Asia & Indian Ocean
  { code: "DEL", name: "Delhi", types: ["city", "culture"], core: true },
  { code: "BOM", name: "Mumbai", types: ["city", "culture"], core: true },
  { code: "GOI", name: "Goa", types: ["beach"], core: true },
  { code: "CMB", name: "Colombo", types: ["beach", "culture", "nature"], core: true },
  { code: "MLE", name: "Maldives", types: ["beach"], core: true, aka: ["Male"] },
  { code: "KTM", name: "Kathmandu", types: ["culture", "nature"], core: true },
  { code: "MRU", name: "Mauritius", types: ["beach"], core: true },
  { code: "SEZ", name: "Seychelles", types: ["beach", "nature"], core: true },
  // Middle East
  { code: "DXB", name: "Dubai", types: ["city", "beach", "theme"], core: true },
  { code: "AUH", name: "Abu Dhabi", types: ["city", "beach", "theme"], core: true },
  { code: "DOH", name: "Doha", types: ["city"], core: true },
  { code: "MCT", name: "Muscat", types: ["beach", "culture", "nature"], core: true },
  // USA & Canada
  { code: "NYC", name: "New York", types: ["city", "culture"], core: true },
  { code: "BOS", name: "Boston", types: ["city", "culture"], core: true },
  { code: "WAS", name: "Washington", types: ["city", "culture"] },
  { code: "CHI", name: "Chicago", types: ["city"] },
  { code: "ORL", name: "Orlando", types: ["theme"], core: true, aka: ["Disney World", "Florida"] },
  { code: "MIA", name: "Miami", types: ["beach", "city"], core: true },
  { code: "LAS", name: "Las Vegas", types: ["city", "nature"], core: true },
  { code: "LAX", name: "Los Angeles", types: ["city", "beach", "theme"], core: true },
  { code: "SFO", name: "San Francisco", types: ["city"], core: true },
  { code: "SAN", name: "San Diego", types: ["beach", "theme"] },
  { code: "SEA", name: "Seattle", types: ["city", "nature"] },
  { code: "DEN", name: "Denver", types: ["ski", "nature"] },
  { code: "SLC", name: "Salt Lake City", types: ["ski", "nature"] },
  { code: "HNL", name: "Honolulu", types: ["beach", "nature"] },
  { code: "YTO", name: "Toronto", types: ["city"], core: true },
  { code: "YVR", name: "Vancouver", types: ["city", "nature", "ski"], core: true },
  { code: "YMQ", name: "Montreal", types: ["city", "culture"] },
  { code: "YYC", name: "Calgary", types: ["ski", "nature"] },
  // Caribbean & Latin America
  { code: "CUN", name: "Cancún", types: ["beach", "culture"], core: true },
  { code: "MEX", name: "Mexico City", types: ["city", "culture"], core: true },
  { code: "PUJ", name: "Punta Cana", types: ["beach"], core: true },
  { code: "MBJ", name: "Montego Bay", types: ["beach"], core: true },
  { code: "BGI", name: "Barbados", types: ["beach"], core: true },
  { code: "ANU", name: "Antigua", types: ["beach"] },
  { code: "SLU", name: "St Lucia", types: ["beach", "nature"], aka: ["Saint Lucia"] },
  { code: "NAS", name: "Nassau", types: ["beach"] },
  { code: "AUA", name: "Aruba", types: ["beach"] },
  { code: "HAV", name: "Havana", types: ["city", "culture", "beach"], core: true },
  { code: "SJO", name: "San José", types: ["nature"] },
  { code: "CTG", name: "Cartagena", types: ["beach", "culture"] },
  { code: "RIO", name: "Rio de Janeiro", types: ["city", "beach"], core: true },
  { code: "BUE", name: "Buenos Aires", types: ["city", "culture"], core: true },
  { code: "LIM", name: "Lima", types: ["city", "culture"], core: true },
  { code: "CUZ", name: "Cusco", types: ["culture", "nature"], aka: ["Machu Picchu"] },
  { code: "SCL", name: "Santiago", types: ["city", "ski", "nature"] },
  // Africa
  { code: "CPT", name: "Cape Town", types: ["city", "nature", "beach"], core: true },
  { code: "JNB", name: "Johannesburg", types: ["city", "nature"], core: true },
  { code: "NBO", name: "Nairobi", types: ["nature"], core: true },
  { code: "MBA", name: "Mombasa", types: ["beach", "nature"] },
  { code: "ZNZ", name: "Zanzibar", types: ["beach", "culture"], core: true },
  { code: "JRO", name: "Kilimanjaro", types: ["nature"], aka: ["Serengeti", "Arusha"] },
  { code: "VFA", name: "Victoria Falls", types: ["nature"] },
  { code: "WDH", name: "Windhoek", types: ["nature"] },
  // Australia, New Zealand & the Pacific
  { code: "SYD", name: "Sydney", types: ["city", "beach"], core: true },
  { code: "MEL", name: "Melbourne", types: ["city", "culture"], core: true },
  { code: "BNE", name: "Brisbane", types: ["city", "beach", "theme"] },
  { code: "CNS", name: "Cairns", types: ["nature", "beach"], aka: ["Great Barrier Reef"] },
  { code: "PER", name: "Perth", types: ["city", "beach"], core: true },
  { code: "AKL", name: "Auckland", types: ["city", "nature"], core: true },
  { code: "ZQN", name: "Queenstown", types: ["nature", "ski"] },
  { code: "NAN", name: "Fiji", types: ["beach"], aka: ["Nadi"] },
];

/** Places asked about one by one in "Anywhere far away" searches. */
export const CORE_PLACE_CODES = POPULAR_PLACES.filter((p) => p.core).map((p) => p.code);

/** "Anywhere far away" only shows places at least this far from the home airport. */
export const MIN_LONG_HAUL_KM = 2000;

/** A destination as the form knows it: any far-away city, popular or not. */
export interface LongHaulPlace {
  code: string;
  name: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  /** Popular places only. */
  types?: HolidayType[];
  /** Popular places only: what else it's searched as, e.g. "Kyoto". */
  aka?: string[];
  popular?: boolean;
}
