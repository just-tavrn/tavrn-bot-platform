# tavrn bot platform

A complete example bot for [tavrn](https://github.com/just-tavrn/tavrn) with a web dashboard, for any number of
rooms: people register, connect their tavrn room and switch on and configure what they need. It is meant to be read
and extended, and it is small enough for that: one Node.js process, SQLite, a module directory per feature.

| Module | What it does |
|---|---|
| Welcome | welcome and goodbye messages with `{user}`, `{room}`, `{count}`, an optional DM, roles on join |
| Auto-moderation | blocked words and patterns, links outside an allow-list, invite links, capitals, mention spam, floods, repeated messages, new accounts; per rule delete, warn, time out, kick or ban; exempt roles and channels; a log channel. It complements the node's own automod. |
| Moderation | a case log for tavrn's own kicks, bans, timeouts and purges (read from the room's audit log, so the client's `/kick` counts too), `/warn`, `/warnings` and `/case`, a mod-log channel, a DM to the member, and forms in the dashboard to time out, kick, ban and unban |
| Levels | experience per message with a cooldown, level-up messages, roles at levels (stacked or replaced), `/rank`, `/leaderboard` with page buttons, an opt-in public leaderboard page |
| Role menus | messages with buttons or a select menu where members pick roles (several or one), edited in the dashboard |
| Custom commands | your own `/name` commands that answer with a text (placeholders, private answers, role limits) |
| Polls | tavrn's own native polls created from the dashboard, now or at a set time; a results summary when a timed poll closes; the results of the bot's polls and of polls it saw votes for |
| Social alerts | RSS/Atom feeds, YouTube channels and Twitch streams posted to a channel, once per item |
| Raid helper | raid events with sign-up by class and spec, automatic Tank / Healer / DPS groups with caps, bench, tentative, decline, leader tools, reminders; games are data (World of Warcraft and Final Fantasy XIV shipped, more in the dashboard) |
| Starboard | messages with enough reactions of an emoji are reposted to a starboard channel |
| Announcements | scheduled messages: once, daily or weekly in the room's time zone |

The bot's commands: `/connect`, `/dashboard`, `/warn`, `/warnings`, `/case`, `/rank`, `/leaderboard`, `/raid`,
`/raids`, `/cmd` and the room's custom commands. None of them repeats a command of the tavrn client (`/ban /kick
/timeout /mute /unmute /purge /slowmode /poll /nick /topic /move /whiteboard /help /me /shrug`): for those the bot
uses tavrn's own functions. A custom command with such a name is reached with `/cmd <name>` only.

Screenshots follow.

## Quick start (Docker)

1. **Create the application** on your tavrn node (web client: settings → *Applications* → *New application*), public,
   with these **scopes** for its token: `messages:read`, `messages:write`, `members:read`, `moderation`,
   `rooms:manage`, `commands`, `dms`. Request these **permissions** (installers can clear any of them): View
   channels, Send messages, Read message history, Add reactions, Send polls, Manage messages, Kick members, Ban
   members, Moderate members (timeouts), View audit log (the moderation cases of the client's own `/kick`, `/ban`,
   `/timeout`, `/purge`), Manage roles (role menus, level and welcome roles). Create a token and keep its secret.
2. **Run the container** with a volume for `/data` (database, the bot's key file and its encryption state):

   ```sh
   docker run -d --name tavrn-bot -p 127.0.0.1:8787:8787 -v tavrn-bot:/data \
     -e BASE_URL=https://bot.example.org -e TAVRN_BOT_TOKEN=… -e SESSION_SECRET="$(openssl rand -hex 32)" \
     -e SMTP_HOST=mail.example.org -e SMTP_USER=bot@example.org -e SMTP_PASSWORD=secret -e MAIL_FROM="tavrn bot <bot@example.org>" \
     -e ADMIN_EMAILS=you@example.org -e TRUST_PROXY=1 ghcr.io/just-tavrn/tavrn-bot-platform:edge
   ```

   or use [`docker-compose.yml`](docker-compose.yml). Put it behind a reverse proxy with HTTPS (below).
3. **Back up `/data`.** The key file `tavrn-key.txt` is the bot's identity: without it the bot cannot read its
   encrypted channels any more (the @tavrn/bot README, "The key file").

### Connecting a room

1. Register on the dashboard and confirm the e-mail address.
2. *Dashboard* → *Connect a room*: the page shows the bot's add link and a one-time code (15 minutes).
3. Add the bot to your room with the add link (you need *Manage applications* there).
4. In the room, run `/connect ABCD-EFGH`. The bot checks that you hold *Manage room* in that room and links it to
   your account; the dashboard shows the room a moment later. Other managers of the room connect it the same way
   with their own code and manage it together with you.

Every module starts switched off. Rooms on other nodes work too (the runtime follows its installations through
federation).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://127.0.0.1:8787` | the public URL of the dashboard (links in mails and in the bot's answers; the CSRF check compares the `Origin` with it) |
| `TAVRN_BOT_TOKEN` | – | the app token; without it the dashboard runs and the bot stays offline. Only read from the environment. |
| `TAVRN_NODE` | the token's issuer (discovered) | only to reach the home node at another address than its discovery document says, e.g. an internal URL (`http://tavrn:8080`); a public node needs nothing here |
| `SESSION_SECRET` | random per start (development) | at least 32 characters; required in production. Keys the hashes of sessions, mail links and codes. |
| `SMTP_HOST` | – | the mail server; without it the mails (with their links) are written to the log and the UI says so |
| `SMTP_PORT` | 465 (`tls`), else 587 | the port |
| `SMTP_SECURITY` | `tls` on 465, else `starttls` | `tls` (TLS from the start, port 465), `starttls` (plain connection upgraded, port 587) or `none` (a local relay) |
| `SMTP_USER`, `SMTP_PASSWORD` | – | the login, as plain text (no URL encoding); without a user the server is used without login |
| `MAIL_FROM` | `tavrn bot <bot@localhost>` | sender of the mails |
| `ADMIN_EMAILS` | – | comma-separated: these accounts see the operator page (rooms, users, bot status, disabling a room) |
| `TRUST_PROXY` | – | `1`: take the client address from `X-Forwarded-For` (rate limits); only behind your own proxy |
| `REGISTRATION` | open | `closed` refuses new accounts |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | – | Twitch live alerts (an app of the Twitch developer console); without them Twitch feeds are skipped |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | where the server listens |
| `DATA_DIR` | `./.data` (`/data` in the image) | SQLite database, key file (`tavrn-key.txt`) and encryption state (`tavrn-state/`) |
| `TAVRN_BOT_KEY_FILE`, `TAVRN_BOT_STATE_DIR` | in `DATA_DIR` | other places for the key file and the state |
| `TZ` | `UTC` | the process time zone (logs); rooms set their own time zone in the dashboard |
| `FAKE_BOT` | – | development and tests only: an in-memory fake instead of tavrn, plus test hooks (refused with `NODE_ENV=production`) |

## Reverse proxy

The container speaks plain HTTP on port 8787; the proxy terminates HTTPS. Set `BASE_URL` to the public URL and
`TRUST_PROXY=1`.

**Caddy**

```caddyfile
bot.example.org {
	reverse_proxy 127.0.0.1:8787
}
```

**Nginx Proxy Manager**: add a proxy host for `bot.example.org` → `http`, the container's name or address, port
`8787`; on the *SSL* tab request a certificate and switch on *Force SSL* and *HTTP/2*. Nothing else is needed (no
WebSockets: the browser only talks JSON to the server).

## Security

The dashboard trusts nobody's word for a room: a platform user manages a room only after running `/connect` in it
while holding *Manage room* there (checked by the bot against the invoker's permissions as the node reports them), and
every room page checks again, against the room's roles, that the user still manages it (else the access is removed).
In tavrn, every moderation, raid-leader and role-menu action checks the **invoker's** permissions and the role
hierarchy in the bot, never trusting the UI or a component's `custom_id` (custom ids only name things the bot then
looks up in the room's own data). Accounts use scrypt password hashes, HttpOnly SameSite=Lax session cookies (Secure
behind HTTPS), an `Origin` check on every state-changing request, rate limits on the auth routes, answers that never
tell whether an address is registered, and revoke all sessions on a password change or reset; only HMACs of session
tokens, mail links and connect codes are stored. Every API body is validated (zod, and the module schemas), the CSP
allows only the server's own scripts and styles, and feeds are fetched only from public addresses (SSRF). Content of
encrypted channels never leaves them: automod and moderation logs name the rule, not the message, and the starboard
reposts encrypted messages only into an encrypted starboard. The app token comes only from the environment and is
never logged. What the platform cannot protect: whoever runs it can read what the bot can read (it is a member of the
rooms that installed it), so install it only from operators you trust.

## Extending

### Adding a module

A module is a directory `server/modules/<id>/` with an `index.ts` and its tests, listed in
`server/modules/index.ts`:

```ts
import { defineModule, type Settings } from "../types";
import { post } from "../util";

interface S extends Settings { channel: string; text: string }

export default defineModule<S>({
  id: "hello",
  title: "Hello",
  description: "Answers /hello and greets every new member.",
  defaults: { channel: "", text: "Hello {user}!" },
  schema: [
    { key: "channel", type: "channel", label: "Channel" },
    { key: "text", type: "text", label: "Greeting", max: 500 },
  ],
  commands: [{ name: "hello", description: "Say hello", args: [], default_permissions: null, dm_allowed: false }],
  register(ctx) {
    ctx.command("hello", (i) => i.reply(`Hello ${i.user}!`));
    ctx.on("memberJoin", (e, room, s) => post(ctx, room, s.channel, s.text.replace("{user}", `@${e.user}`)));
  },
});
```

The dashboard renders the settings form from `schema` (field types `boolean`, `number`, `string`, `text`,
`select`, `channel`, `channels`, `role`, `roles`, `strings`, `datetime` and `items` for lists of objects) and adds
the on/off switch; no UI code is needed. Handlers registered through `ctx` run only in connected rooms where the
module is on. `ctx` also offers the database (`ctx.db`, plain SQL; add tables as a new entry at the end of the
migrations in `server/db.ts`), a small key-value state per room (`ctx.state`), the room cache with roles and
members (`ctx.cache`), `ctx.every(ms, fn)` for scheduled work, `ctx.addCase` for the moderation log and `onSave` to
act when the settings change. Lists that need their own tables (the raid helper's events) are `collections`; a
collection without `list` is a form that runs an action (the moderation module's "Kick a member"). Do not announce a
command the tavrn client already has (`CLIENT_COMMANDS` in `server/tavrn.ts`): the platform leaves such names out.

### Adding a game to the raid helper

In the dashboard: room → *Raid helper* → *Games* → *New*: a name, classes, and for each class its specs with the role
they play (tank, healer, DPS). Shipped games are JSON files in `server/modules/raid-helper/games/`
(`{ "key", "name", "classes": [{ "name", "specs": [{ "name", "role" }] }] }`); add one there and list it in
`SHIPPED` in `server/modules/raid-helper/index.ts`. A game whose classes have more than 25 specs in total is shown
in several menus (at most three on a card).

## Development

```sh
pnpm install
FAKE_BOT=1 pnpm dev          # dashboard at http://127.0.0.1:5173 with a fake room, no tavrn node needed
pnpm dev                     # against a real node: TAVRN_BOT_TOKEN etc. in .env (see .env.example)
pnpm check                   # SPDX headers, licenses, typecheck, Vitest
pnpm build && pnpm start     # the production build, served by the server on :8787
```

Without SMTP the confirmation link is in the server log. The Playwright spec in `e2e/` runs the main flow
(registration with the confirmation link, connecting the fake room, switching a module on, saving settings,
creating a raid event) against the dev servers with the fake bot, locally only:

```sh
pnpm exec playwright install chromium   # once
pnpm e2e
```

The stack: Hono (HTTP), `@tavrn/bot` (the bot runtime), `node:sqlite`, zod, nodemailer; Preact, Vite and Tailwind
for the UI (the tokens of the tavrn website). TypeScript runs directly through `tsx`; only the UI is built.

## License

[Apache-2.0](LICENSE). Use it, change it, run it, build your own bot on it. Contributions need the
[CLA](CLA.md).
