// Major UK airports with locations, for picking home airports in "Further
// away" (search, or "Near me" from the browser's location).

export interface UkAirport {
  code: string;
  name: string;
  /** Where it is, for the search ("Leeds", "Midlands"...). */
  area: string;
  lat: number;
  lon: number;
}

export const UK_MAJOR_AIRPORTS: UkAirport[] = [
  { code: "MAN", name: "Manchester", area: "North West", lat: 53.354, lon: -2.275 },
  { code: "LPL", name: "Liverpool", area: "North West", lat: 53.334, lon: -2.85 },
  { code: "LBA", name: "Leeds Bradford", area: "Yorkshire", lat: 53.866, lon: -1.661 },
  { code: "HUY", name: "Humberside", area: "Yorkshire, Hull", lat: 53.574, lon: -0.351 },
  { code: "NCL", name: "Newcastle", area: "North East", lat: 55.038, lon: -1.692 },
  { code: "MME", name: "Teesside", area: "North East, Middlesbrough, Darlington", lat: 54.509, lon: -1.429 },
  { code: "EMA", name: "East Midlands", area: "Midlands, Nottingham, Derby, Leicester", lat: 52.831, lon: -1.328 },
  { code: "BHX", name: "Birmingham", area: "Midlands", lat: 52.454, lon: -1.748 },
  { code: "LHR", name: "London Heathrow", area: "London", lat: 51.47, lon: -0.454 },
  { code: "LGW", name: "London Gatwick", area: "London, Sussex", lat: 51.148, lon: -0.19 },
  { code: "STN", name: "London Stansted", area: "London, Essex", lat: 51.885, lon: 0.235 },
  { code: "LTN", name: "London Luton", area: "London, Bedfordshire", lat: 51.875, lon: -0.368 },
  { code: "LCY", name: "London City", area: "London", lat: 51.505, lon: 0.055 },
  { code: "SEN", name: "London Southend", area: "London, Essex", lat: 51.571, lon: 0.696 },
  { code: "NWI", name: "Norwich", area: "East Anglia, Norfolk", lat: 52.676, lon: 1.283 },
  { code: "BRS", name: "Bristol", area: "South West", lat: 51.383, lon: -2.719 },
  { code: "CWL", name: "Cardiff", area: "Wales", lat: 51.397, lon: -3.343 },
  { code: "SOU", name: "Southampton", area: "South, Hampshire", lat: 50.95, lon: -1.357 },
  { code: "BOH", name: "Bournemouth", area: "South, Dorset", lat: 50.78, lon: -1.843 },
  { code: "EXT", name: "Exeter", area: "South West, Devon", lat: 50.734, lon: -3.414 },
  { code: "NQY", name: "Newquay", area: "South West, Cornwall", lat: 50.441, lon: -5.006 },
  { code: "EDI", name: "Edinburgh", area: "Scotland", lat: 55.95, lon: -3.373 },
  { code: "GLA", name: "Glasgow", area: "Scotland", lat: 55.872, lon: -4.433 },
  { code: "PIK", name: "Glasgow Prestwick", area: "Scotland, Ayrshire", lat: 55.509, lon: -4.587 },
  { code: "ABZ", name: "Aberdeen", area: "Scotland", lat: 57.202, lon: -2.198 },
  { code: "INV", name: "Inverness", area: "Scotland, Highlands", lat: 57.542, lon: -4.048 },
  { code: "BFS", name: "Belfast International", area: "Northern Ireland", lat: 54.658, lon: -6.216 },
  { code: "BHD", name: "Belfast City", area: "Northern Ireland", lat: 54.618, lon: -5.873 },
  { code: "LDY", name: "Derry", area: "Northern Ireland, Londonderry", lat: 55.043, lon: -7.161 },
];

const BY_CODE = new Map(UK_MAJOR_AIRPORTS.map((a) => [a.code, a]));

export const ukAirportName = (code: string) => BY_CODE.get(code)?.name ?? code;

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Airports within `radiusKm` of a point (at least the nearest two), nearest first. */
export function airportsNear(lat: number, lon: number, radiusKm = 110): (UkAirport & { km: number })[] {
  const sorted = UK_MAJOR_AIRPORTS.map((a) => ({ ...a, km: Math.round(km({ lat, lon }, a)) })).sort(
    (a, b) => a.km - b.km,
  );
  const near = sorted.filter((a) => a.km <= radiusKm);
  return near.length >= 2 ? near.slice(0, 6) : sorted.slice(0, 2);
}
