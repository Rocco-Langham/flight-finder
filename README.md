# Cheap Escapes ✈️

Find the cheapest day trips and weekend getaways from your local airports.

## Download

1. Click the green **Code** button at the top of this page, then **Download ZIP**.
2. Unzip it.

## Install (once)

1. Install **Node.js** (the LTS version) from [nodejs.org](https://nodejs.org).
2. Open **Terminal** (Mac) or **Command Prompt** (Windows).
3. Go into the unzipped folder and install:
   ```
   cd Downloads/flight-finder-main
   npm install
   ```

## Use

1. In the same folder, run:
   ```
   npm run dev
   ```
2. Open **http://localhost:3000** in your browser.
3. Pick your airports, dates and trip type, then click **Find cheapest**.

To stop it, press **Ctrl + C** in the Terminal window.

## Optional: live prices and hotels

The **Check live price** and **Find a hotel** buttons need a free key:

1. Sign up at [serpapi.com](https://serpapi.com) and copy your API key.
2. In the folder, make a copy of `.env.example` called `.env.local`.
3. Open `.env.local` and paste your key after `SERPAPI_KEY=`.
4. Stop the app (Ctrl + C) and run `npm run dev` again.

## If something goes wrong

- **"Ryanair is temporarily refusing requests"**: you've searched a lot in a short time. Wait 5–10 minutes and try again.
- **`npm` not found**: Node.js isn't installed yet (see Install, step 1). Close and reopen Terminal after installing it.
