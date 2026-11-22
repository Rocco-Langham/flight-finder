# Cheap Escapes 

Find the cheapest day trips and weekend getaways from your local airports.

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
