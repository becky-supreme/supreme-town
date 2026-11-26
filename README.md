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

If a microphone or camera unplugs, that person sees a warning they can click to reconnect, and the town tries the default microphone again on the calls already open. Other people see "no mic" on their name instead of silence with no explanation. A call that fails tries to reconnect before it is hung up and started again.

## The arcade

Two cabinets in The Afterworks run Lead Volley, a 1v1 paddle game. The first person plays the computer; a second person at the same cabinet makes it head to head. New games go in `public/arcade.js`.

## Dancing, sound and decorating

- **Dance:** V or the Dance button. Everyone sees it.
- **Confetti:** Q (not while typing) throws confetti at whoever you are facing, or the nearest person if nobody is in front. Everyone nearby sees it, with both names. Once every couple of seconds.
- **Who's here:** the "here" button lists everyone, with private messages, go to, follow, wave and invite. Private messages go only to the other person and aren't saved.
- **Wave, invite over, follow:** click another person for the menu. Waves and invites aren't delivered to people set to In a meeting or Busy, and each person can send one every 2 seconds.
- **Sound:** made in the browser in `public/sound.js` (no audio files), including an original loop for the dance floor. The Sound button mutes it.
- **Decorate:** anyone can describe one thing ("a birthday cake") and the AI builds it on a single free square next to them, or in an area they pick from `DECOR_AREAS` in `public/world.js`. Things never block anyone, are saved in the data folder (`decor-items.json`), can be taken away by anyone, and disappear after 24 hours. At most 10 per area and 60 in the whole town.

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

With `GOOGLE_CLIENT_ID` set, people sign in with Google. Any Google account can come in. The sign-in screen suggests `@supremeopti.com` (change the suggestion with `ALLOWED_EMAIL_DOMAIN`); that domain is not a rule. They stay signed in for 30 days. The first time, they make a character (name, shirt, hair, skin); it is saved against their email and follows them to any browser. A Google Cloud consent screen set to Internal still only allows your Workspace users, which is Google's own setting, not this app.

To get a client ID: Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Under "Authorised JavaScript origins" add the address the office is hosted at (and `http://localhost:3210` for testing). Setting the consent screen's user type to Internal also limits it to your Google Workspace.

With no client ID, there are no logins and people just type a name. That is only for running it on your own computer.

## Slack

While someone is in the town, their Slack status says **In Supreme Town** (office emoji). When they leave, disconnect, or time out, that status is removed only if it is still the one the town set, so a status they chose themselves is left as they set it. If they already had a status, it is put back. A private channel named **supreme-town** gets a plain line, with no @mentions: "Jake has joined Supreme Town" or "Jake has left Supreme Town". If `SLACK_TOWN_CHANNEL_ID` is unset, the bot creates that private channel (or reuses it when the bot is already in it) and saves the id in the data folder. If the channel cannot be created, the account managers' channel is used instead. People are invited in when they connect Slack or enter the town, including everyone already connected the next time the town starts. A refresh, a second tab, or a short drop does not post twice. The town waits about a minute and a half before saying someone has left.

Connect Slack is required before Enter works. Each person does it once. With Google sign-in, the connection is remembered against their email, on any browser. Without Google sign-in, a long-lived cookie remembers that browser. If Slack later rejects the connection, they are asked again. If the settings below are missing, the server logs a warning, skips the step, and the town still runs.

Connections are saved in the data folder (`DATA_DIR`, the Railway volume at `/data`), encrypted with the session secret. They survive restarts and redeploys. No separate database.

### Slack app

1. Create a Slack app at https://api.slack.com/apps in the Supreme Optimization workspace.
2. Under **OAuth & Permissions**, add the bot scopes `chat:write` and `groups:write`. `groups:write` is what lets the bot create the private channel and invite people. `groups:read` is optional; it is only used to find a `#supreme-town` channel the bot is already in when the saved id is missing.
3. Add the user scopes `users.profile:read` and `users.profile:write`. The read scope is how the town checks the status is still its own before clearing it.
4. Add this redirect URL: `https://supreme-town-production.up.railway.app/api/slack/callback`
5. Install the app to the workspace and copy the **Bot User OAuth Token** (`xoxb-...`). Invite the app into the account managers' channel, and copy that channel's ID (`C...`, from the channel details).
6. On **Basic Information**, copy the Client ID and Client Secret.

### Railway variables

On the `supreme-town` service, set:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_AM_CHANNEL_ID=C...
# Optional. Leave unset and the bot creates a private #supreme-town channel.
# SLACK_TOWN_CHANNEL_ID=C...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_REDIRECT_URL=https://supreme-town-production.up.railway.app/api/slack/callback
```

`SLACK_REDIRECT_URL` has to match the redirect URL in the Slack app exactly. Leave any of them unset and the part that needs them stays off. Each person then opens the town, signs in, and presses **Connect Slack to enter** once.

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

## Keeping it quick

The 3D view is kept light so it runs smoothly on ordinary laptops and big screens: no glow filter, no coloured lamps, no floating sparkles, drawing capped at 1.25x pixel density and 60 frames a second, and each person drawn as a handful of shapes rather than dozens. Shadows stay. The settings are at the top of `public/scene3d.js` (pixel density, shadows, and `LAMPS` for the coloured lamps) and `MIN_FRAME` in `public/main.js`.
