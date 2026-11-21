import { addDays, todayISO, weekday } from "@/lib/dates";
import type { TimeWindow } from "@/lib/types";

export type TripPreset = "day" | "fri-sat" | "fri-sun" | "fri-weekend" | "custom";

export interface PresetConfig {
  label: string;
  hint: string;
  outDays: number[];
  nights: number[];
  outWindow: TimeWindow;
  returnWindow: TimeWindow;
  minHoursAtDestination: number;
  /** Default search range length in days. */
  rangeDays: number;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const PRESETS: Record<TripPreset, PresetConfig> = {
  day: {
    label: "Day trip",
    hint: "Out in the morning, home the same night",
    outDays: ALL_DAYS,
    nights: [0],
    outWindow: { from: "05:00", to: "10:00" },
    returnWindow: { from: "16:00", to: "23:59" },
    minHoursAtDestination: 5,
    rangeDays: 28,
  },
  "fri-sat": {
    label: "Fri night → Sat",
    hint: "Leave after work Friday, back Saturday evening",
    outDays: [5],
    nights: [1],
    outWindow: { from: "17:00", to: "23:59" },
    returnWindow: { from: "16:00", to: "23:59" },
    minHoursAtDestination: 3,
    rangeDays: 56,
  },
  "fri-sun": {
    label: "Fri night → Sun",
    hint: "Leave after work Friday, back Sunday evening",
    outDays: [5],
    nights: [2],
    outWindow: { from: "17:00", to: "23:59" },
    returnWindow: { from: "16:00", to: "23:59" },
    minHoursAtDestination: 3,
    rangeDays: 56,
  },
  "fri-weekend": {
    label: "Fri → Sat or Sun",
    hint: "Whichever return day is cheapest",
    outDays: [5],
    nights: [1, 2],
    outWindow: { from: "17:00", to: "23:59" },
    returnWindow: { from: "16:00", to: "23:59" },
    minHoursAtDestination: 3,
    rangeDays: 56,
  },
  custom: {
    label: "Custom",
    hint: "Choose the days, nights and times yourself",
    outDays: ALL_DAYS,
    nights: [0, 1, 2],
    outWindow: { from: "05:00", to: "23:59" },
    returnWindow: { from: "05:00", to: "23:59" },
    minHoursAtDestination: 3,
    rangeDays: 21,
  },
};

export function defaultRange(rangeDays: number): { dateFrom: string; dateTo: string } {
  const dateFrom = addDays(todayISO(), 1);
  return { dateFrom, dateTo: addDays(dateFrom, rangeDays - 1) };
}

export function countOutboundDates(dateFrom: string, dateTo: string, outDays: number[]): number {
  if (!dateFrom || !dateTo || dateTo < dateFrom) return 0;
  let n = 0;
  for (let d = dateFrom; d <= dateTo && n < 400; d = addDays(d, 1)) {
    if (outDays.includes(weekday(d))) n++;
  }
  return n;
}

export interface HomeAirport {
  code: string;
  name: string;
}

/** UK airports with Ryanair flights. The first three are the defaults. */
export const UK_AIRPORTS: HomeAirport[] = [
  { code: "MAN", name: "Manchester" },
  { code: "LPL", name: "Liverpool" },
  { code: "LBA", name: "Leeds Bradford" },
  { code: "EMA", name: "East Midlands" },
  { code: "BHX", name: "Birmingham" },
  { code: "NCL", name: "Newcastle" },
  { code: "STN", name: "London Stansted" },
  { code: "LTN", name: "London Luton" },
  { code: "LGW", name: "London Gatwick" },
  { code: "BRS", name: "Bristol" },
  { code: "BOH", name: "Bournemouth" },
  { code: "EXT", name: "Exeter" },
  { code: "NQY", name: "Newquay" },
  { code: "CWL", name: "Cardiff" },
  { code: "EDI", name: "Edinburgh" },
  { code: "GLA", name: "Glasgow" },
  { code: "PIK", name: "Glasgow Prestwick" },
  { code: "ABZ", name: "Aberdeen" },
  { code: "BFS", name: "Belfast International" },
  { code: "BHD", name: "Belfast City" },
];

export const DEFAULT_HOMES = ["MAN", "LPL", "LBA"];

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
