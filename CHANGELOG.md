# Changelog

## Unreleased

### Fixed

- Without `TAVRN_NODE` the bot resolves its home node through discovery (a domain whose API lives on another host, like
  `tavrn.org` → `app.tavrn.org`, failed with "could not be reached"); the add link points at the node's web client.

### Changed

- Moderation uses tavrn's own kicks, bans, timeouts and purges: the module reads the room's audit log every minute
  and turns them into cases with the mod-log line and the DM to the member, also for the client's `/kick` and
  friends (the bot needs *View audit log*). New `/case <id>`; the dashboard's moderation page has forms to time
  out, kick, ban and unban that check the platform user's permission and rank in tavrn first.
- Polls are created from the dashboard (now or at a set time); the dashboard lists their results and those of
  polls the bot saw votes for.
- The platform announces no command the tavrn client already has, also not as a custom command (`/cmd <name>`
  still reaches it).

### Removed

- The commands `/timeout /kick /ban /unban /purge /slowmode` and `/poll`: the client's built-in ones do the same.
  The settings "Ask before banning" and "Members without Send polls may use /poll" went with them.

## 0.1.0 (unreleased)

- First version: one process with the dashboard, the API and the bot; accounts with e-mail confirmation; rooms
  connected with `/connect`; modules welcome, auto-moderation, moderation, levels, role menus, custom commands,
  polls (tavrn's native polls), social alerts, starboard, announcements and the raid helper; one container image.
