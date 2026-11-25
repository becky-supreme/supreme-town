# Supreme Town

Supreme Optimization's 3D virtual office, running in the browser. Walk around, talk to whoever is nearby, sit anywhere, restyle any desk, grab a drink, ride a go-kart and ask the team receptionists.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3210. Open it in two browser windows to see two people.

## Turn on the AI

The desk designer and the bots need an AI key in `.env`. Use one of:

```
OPENROUTER_API_KEY=your-key-here
```

or

```
ANTHROPIC_API_KEY=your-key-here
```

With OpenRouter you can also choose the model with `OPENROUTER_MODEL` (default `anthropic/claude-opus-5.5`; for Grok use `x-ai/grok-4.7`). Restart the server after changing it.

Without a key the office still works: desks use the six designs, and the bots say they are not switched on.

## Add a bot for your team

Add an entry to `config/bots.json`:

- `id`, `name`, `title`: who the bot is.
- `x`, `y`: the floor tile it stands on (the town is 46 by 44; each team's reception spot is listed as `botSpot` in `public/world.js`).
- `color`: its colour.
- `greeting`: the first thing it says.
- `system`: its personality and job, in plain English.
- `knowledge`: files it should answer from, for example `["knowledge/design-team.md"]`.

Bots only answer from their knowledge files, and say so when something is not covered. `knowledge/am-processes.md` is empty until someone pastes the AM processes into it.

## Sync bots to Notion

One Notion key covers the whole office; each bot is pointed at its own page or board.

1. In Notion, go to Settings → Connections → Develop or manage integrations, and create a new internal integration. Read content is the only permission it needs.
2. Copy its secret into `.env`:

   ```
   NOTION_TOKEN=your-notion-secret
   ```

3. Share each page or board with the integration: open it, click ••• → Connections, and add the integration. Sharing a parent page covers everything inside it.
4. Paste each link onto the right bot in `config/bots.json`:

   ```json
   "notion": ["https://www.notion.so/your-team/AM-processes-..."]
   ```

   A bot can have several links. A board (database) is read card by card, with each card's properties and page content; a plain page is read as it is.
5. Restart the server.

From each link, a bot reads the pages and boards inside it. Add `"followLinks": true` to a bot to also follow links and @-mentions to pages kept elsewhere in Notion (Amy has this on). Only do that for bots whose links point at material everyone signed in may see, because the bot can repeat anything it reads; it can only ever reach pages shared with the Notion connection. When a bot is asked something, it gets a contents list of every page plus the full text of the pages most relevant to the question.

Bots re-read Notion every 30 minutes (change with `NOTION_SYNC_MINUTES` in `.env`), and only download pages that changed. If Notion is unreachable, a bot keeps what it read last time. Limits: 600 pages per bot, 200 cards per board.

## Add things to the map

Open `public/extras.js` and add a line per thing, for example `{ item: 'sofa', x: 20, y: 29 }`. The file lists everything you can add (plants, sofas, seats, tables, rides, showpieces). To find the x and y of a spot, press G in the town and point at the floor.

Then run `npm run check`. It tells you in plain English if anything is on top of something else or can't be reached. Restart the server (or push to GitHub) to see it.

Changing the map never touches people's logins, characters or desk designs: those are saved separately in the data folder.

## Who can hear whom

- At the desks: only someone right next to you.
- In the streets and kitchen: anyone within about four squares.
- In a shared space (co-working lounge, The Afterworks, the lunch area, a team social, the meeting room): everyone in that space, and nobody outside it.

The distances are at the top of `public/world.js`.

## The arcade

Two cabinets in The Afterworks run Lead Volley, a 1v1 paddle game. The first person plays the computer; a second person at the same cabinet makes it head to head. New games go in `public/arcade.js`.

## Dancing, sound and decorating

- **Dance:** V or the Dance button. Everyone sees it.
- **Sound:** made in the browser in `public/sound.js` (no audio files), including an original loop for the dance floor. The Sound button mutes it.
- **Decorate:** the Decorate button lets anyone ask the AI to dress the shared space they're standing in. Decorations are visual only (they never block anyone), are saved in the data folder, and reset after 24 hours. The areas are listed in `DECOR_AREAS` in `public/world.js`.

## Change the town

- `public/world.js`: the floor plan. Team areas, lounge, bar, kitchen, lunch area, meeting room, chairs, rides and how far voices carry.
- `public/presets.js`: the six desk designs.
- `public/avatar.js`: outfits and hairstyles.
- `public/decor.js`: the posters and screens on the walls.
- `public/scene3d.js`: the 3D look: lighting, glow, walls, the globe, DNA and rocket centrepieces.
- `/designs.html` (open it in the browser): every desk design, outfit and hairstyle on one page.

## Settings

Copy `env-template.txt` to `.env` and fill it in. Every setting is explained in the file.

## Logins and characters

With `GOOGLE_CLIENT_ID` set, people sign in with Google and only `@supremeopti.com` accounts get in (change with `ALLOWED_EMAIL_DOMAIN`). They stay signed in for 30 days. The first time, they make a character (name, shirt, hair, skin); it is saved against their email and follows them to any browser.

To get a client ID: Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Under "Authorised JavaScript origins" add the address the office is hosted at (and `http://localhost:3210` for testing). Setting the consent screen's user type to Internal also limits it to your Google Workspace.

With no client ID, there are no logins and people just type a name. That is only for running it on your own computer.

## Hosting on Railway

This follows the same pattern as Vista: push to GitHub, and Railway redeploys whenever the main branch changes.

1. Put this folder in a GitHub repository (the `.gitignore` already keeps `.env`, `data` and `node_modules` out) and create a Railway project from it (New Project → Deploy from GitHub). `railway.json` tells Railway how to start it.
2. Add the settings from `env-template.txt` as Railway variables, by hand, including a `SESSION_SECRET`. A secret that is only in your local `.env` does nothing for the live site.
3. Add a volume mounted at `/data` and set `DATA_DIR=/data`, so desks, characters and the Notion copy survive redeploys.
4. Generate a domain for the service, and add that `https://` address to the Google client's authorised origins.

## Before the whole team uses it

- Browsers only allow microphones and cameras on `https` addresses (or `localhost`). Railway's domain is `https`, so that is covered once hosted.
- Calls go directly between browsers. That is fine for a handful of people standing together; a big all-hands in one spot would need a media server (LiveKit is the usual choice).
- Some company networks block direct calls. Fixing that needs a relay (TURN) server.
- Set `GOOGLE_CLIENT_ID` before sharing the link, or anyone with it can walk in.
