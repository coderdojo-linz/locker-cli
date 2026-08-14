# locker

Your CoderDojo Locker, from the command line. The eight-character code on your
card is how you get in — there is nothing to sign up for.

```bash
npx @coderdojo-linz/locker auth login
npx @coderdojo-linz/locker upload ./my-game --name "Snake"
```

Needs Node 20 or newer. No dependencies, so `npx` starts quickly and there is no
native module to fail on a locked-down laptop.

## The four things you will actually do

```bash
locker auth login                 # enter the code from your card
locker status                     # what is in your locker, and how full it is
locker upload ./my-project        # save work into a new project
locker download Snake             # get work back out
```

`locker --help` lists everything. `locker <command> --help` explains one thing.

## Uploading

Always say where the files go — `--name` makes a new project, `--to` adds to one
that is already there. Neither is guessed, because a project name is not unique
and a coincidence is a poor way to decide where your work lands.

A folder keeps its shape, so this arrives as a `game` folder with `img/` still
inside it:

```bash
locker upload ./game --name "Snake"
```

```bash
locker upload extra-level.py --to Snake
```

Look before you leap. `--dry-run` lists every file, the total, and how much room
is left, without uploading anything:

```bash
locker upload ./game --name "Snake" --dry-run
```

`.git`, `node_modules` and similar are skipped, and the CLI tells you it skipped
them. `--all` includes them.

Adding a file the project already has is refused. Replacing one is something you
ask for outright — see below.

## Changing files

A file can be renamed, moved, or given new contents, and it keeps its id
throughout. That matters: a share link pointing at it goes on working.

```bash
locker files list Snake
locker files rename Snake sprite.png snake-head.png
locker files rename Snake snake-head.png snake-head.png --folder img
locker files replace Snake main.py ./main.py
locker files delete Snake old-notes.txt
```

`--folder ""` moves a file back to the top of the project. `files replace` cannot
be undone, so it asks first and takes `--dry-run` and `--yes` like the other
destructive commands.

## Downloading

```bash
locker download Snake                     # a folder, next to you
locker download Snake --out ~/projects    # a folder, somewhere else
locker download Snake --file sprite.png   # just one file
locker download Snake --archive           # one .zip instead
```

Files already on disk are left alone unless you pass `--force`.

## Naming a project

Anywhere a command takes a project, you can use its name or the short id from
`locker projects list`. If a name matches more than one project, the CLI stops
and shows you the ids rather than guessing — two projects really can share a
name.

## Where the code is kept

The code is resolved in this order, and the first one found wins:

1. `--code` on the command — used once, never saved
2. the `LOCKER_CODE` environment variable
3. whatever `locker auth login` saved for this host

**On a shared computer, prefer not saving anything.** `auth login` is the only
command that ever writes a code to disk; everything else just reads. So on a
Dojo laptop, use the environment variable and leave nothing behind:

```bash
LOCKER_CODE=K7F29QB3 locker status
```

If a code was saved, `locker auth logout` forgets it. `locker config path` shows
where it lives — `%APPDATA%\locker` on Windows, `~/.config/locker` elsewhere
(or `$XDG_CONFIG_HOME`). It is kept in its own file, mode `0600`, apart from the
general settings so that sharing a config never shares a credential.

The code is a full read-and-write credential: anyone who has it can open the
locker. It is stored in a plain file rather than an OS keychain, because every
keychain binding is a native module and native modules are what make `npx` fail.
That is a deliberate trade — anyone who can read your user profile can read the
file.

## Scripting

Every command takes `--json` and answers with the same envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": { "schemaVersion": 1 }
}
```

Machine output always goes to stdout, including failures — so a script never has
to read stderr to find out what went wrong. Progress, warnings and prompts go to
stderr in human mode, and into `meta.warnings` under `--json`. `schemaVersion`
only changes for a breaking change.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | fine |
| `1` | something else went wrong |
| `2` | bad flags, or an answer was needed and nobody could be asked |
| `3` | no locker code, or one that opens nothing |
| `5` | no such project or file |
| `6` | already done, or already there |
| `7` | the locker is full, or busy right now |
| `8` | could not reach the server |
| `10` | you said no to a prompt |

Nothing prompts when output is JSON, when `--quiet` is set, or when there is no
terminal. It refuses with exit `2` and tells you the non-interactive way instead.

## Deleting things

`projects delete`, `files delete` and `share revoke` cannot be undone. Each asks
first, each takes `--dry-run` to preview and `--yes` to skip the question, and
each refuses outright rather than prompting when nobody is there.

```bash
locker projects delete Snake --dry-run
locker projects delete Snake --yes
```

## Settings and environment

| Variable | Same as |
| --- | --- |
| `LOCKER_CODE` | `--code` |
| `LOCKER_HOST` | `--host` |
| `LOCKER_OUTPUT` | `--output` |
| `LOCKER_LANG` | `--lang` |
| `LOCKER_CONFIG` | where settings are kept |
| `NO_COLOR` | `--no-color` |

Flags beat the environment, the environment beats saved settings, and saved
settings beat the defaults — the same order for everything.

`--lang de` or `--lang en` is passed to the server, so its own messages come back
in that language.

Save what you get tired of typing:

```bash
locker config set host locker.coderdojo.net
locker config set lang en
locker config get
```

A locker code is not a setting and `config set` will not take one.

## When something breaks

`-v` adds detail on stderr; `-vv` and `-vvv` add more. Unexpected failures write
a diagnostic file under `logs/` in the config directory, with the locker code and
any signed storage URLs removed, so it is safe to attach to a bug report.

## Another Locker

Point it anywhere; credentials are kept per host:

```bash
locker status --host https://locker.mydojo.example
```

## Development

```bash
npm install
npm run build
npm test
```
