# Cheap Escapes - Beta

Find the cheapest day trips and weekend getaways from your local airports.
Longer trips to places like Japan, Spain, Dubai and more for as cheap as possible!

This program uses a cashe to save previous searches to your drive. This is to speed up searching that have ovelapping elements.
The more you use this program, the faster it gets. If you have large search ranges like 6months, and flights departing from lots of different airports, searches can take over 10minutes. To fix this, reduce the search area.

## How to download and install

1. Click the green **Code** button at the top of this page, then **Download ZIP**.
2. Unzip it.
3. Make sure that you have **Node.js** installed. If not, install **Node.js** (the LTS version) from [nodejs.org](https://nodejs.org).
4. Open **Terminal** (Mac) or **Command Prompt** (Windows).
5. Go into the unzipped folder and install:
   ```
   cd Downloads/flight-finder-main
   npm install
   ```

### To run the program

1. In the same terminal that you installed the program on, run:
   ```
   npm run dev
   ```
2. Open **http://localhost:3000** in your browser.

To stop it, press **Ctrl + C** in the Terminal window.

Live prices (**Check live price**) and **Find a hotel** work straight away: the download includes a shared key.

#### If something goes wrong

- **"Ryanair is temporarily refusing requests"**: you've searched a lot in a short time. Wait 5–10 minutes and try again.
- **Live price or hotel says the limit is reached**: the shared key has used up this month's free searches. They reset monthly.
- **`npm` not found**: Node.js isn't installed yet (see Install, step 1). Close and reopen Terminal after installing it.
