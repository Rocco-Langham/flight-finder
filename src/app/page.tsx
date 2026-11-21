import { FlightSearch } from "@/components/FlightSearch";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Cheap Escapes <span aria-hidden>✈️</span>
        </h1>
        <p className="mt-1 text-slate-600">
          The cheapest day trips and Friday-night getaways from your local airports.
        </p>
      </header>
      <FlightSearch />
      <footer className="mt-10 text-center text-xs text-slate-400">
        Live Ryanair fares, plus easyJet, Jet2 and others from recent searches (Travelpayouts) or a
        live Google Flights check when set up. Prices are cached for up to 30 minutes. Always check the
        price on the airline&apos;s site before booking.
      </footer>
    </main>
  );
}
