# cockpit-cla — Test suite

A real, assertion-based Playwright suite lives under `tests/` (one `*.spec.js` per feature:
`status`, `ask`, `ask-ux`, `chats`, `chat-ask`, `chat-feedback`, `delete-chat`, `context-file`,
`context-attach`, `limits`, `legal`, `markdown`, `code-copy`, `history`, `history-narrow`,
`history-export`, `edge-states`, `security`, `a11y`, `versions`). It runs against a real Cockpit and
a real `clad` daemon, in both Chromium and Firefox.

## What you need

### Two test hosts: RHEL 9 and RHEL 10

The module must work on both, so a change is verified on one RHEL 9 and one RHEL 10 host, running
the full suite against each in turn. Each host needs:

- `cockpit` (the web console listening on port 9090) and `command-line-assistant` 0.4.2 or newer,
  registered with Red Hat so the assistant can answer. A few specs ask the real assistant a short
  question.
- The module under test installed for the test users, e.g. `make` then
  `rsync -a --delete dist/ <user>@<host>:~/.local/share/cockpit/cla/` (a per-user copy in
  `~/.local/share/cockpit/` takes priority over the system package). The disabled user below needs
  its own copy, since `~/.local` is per-user.

Use disposable hosts: the suite writes real history entries for the test user (in the `cockpit`
chat, marked `pw-<browser>-<time>`) and creates and deletes chats named `pw-…`. It never clears
all history. To tidy up afterwards: `c history --clear --from-chat cockpit </dev/null`.

### A normal test user

A regular account (`COCKPIT_USER`/`COCKPIT_PASS`) that can use the assistant and has `sudo`. The
suite logs in to Cockpit and turns on administrative access before opening the module: the module
never calls `clad` with superuser, so running with administrative access on is what proves its
calls still go out as the logged-in user. Both a sudo password prompt and passwordless sudo are
handled. A few specs log in without administrative access to check that root-only files
(`/var/log/secure`) are refused.

### A "denied" user (optional)

The "disabled for your account" state is tested with a real account that a D-Bus policy blocks
from `clad`, the way an administrator would disable the assistant for a user. See "The
disabled-user fixture" below. Without it (`COCKPIT_DENIED_USER`/`COCKPIT_DENIED_PASS` empty) those
specs are skipped and say why.

### ssh access (optional)

With `COCKPIT_SSH` set to `user@host` for the same host and user (key-based login: ssh runs with
`BatchMode=yes`), specs cross-check the page against the host: that a saved answer shows up in
`c history`, that the About popover's version matches `rpm -q`, and that the export's host name
matches `uname -n`. Without it those checks are skipped and recorded as annotations; the rest of
each spec still runs. `COCKPIT_SSH_CONFIG` optionally names an `ssh -F` config file.

## The disabled-user fixture

On each test host, as root:

```bash
useradd denieduser            # a regular account, not in wheel
passwd denieduser

cat > /etc/dbus-1/system.d/zz-cockpit-assistant-test-deny.conf <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<!-- cockpit-cla test fixture: assistant disabled for denieduser -->
<busconfig>
  <policy user="denieduser">
    <deny send_destination="com.redhat.lightspeed.history"/>
    <deny receive_sender="com.redhat.lightspeed.history"/>
    <deny send_destination="com.redhat.lightspeed.user"/>
    <deny receive_sender="com.redhat.lightspeed.user"/>
  </policy>
</busconfig>
EOF
busctl call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig
```

This is the per-user deny block described in the comments of the shipped
`/usr/share/dbus-1/system.d/com.redhat.lightspeed.conf`, in a separate drop-in so the package's own
file is untouched. Check it as that user: `busctl call com.redhat.lightspeed.user
/com/redhat/lightspeed/user com.redhat.lightspeed.user GetUserId i $(id -u)` must fail with
`org.freedesktop.DBus.Error.AccessDenied`, while the normal test user is unaffected. Then copy the
module build into `~denieduser/.local/share/cockpit/cla/` (owned by `denieduser`; run
`restorecon -R` on it).

To remove the fixture: delete the drop-in, run the same `ReloadConfig` call, and
`userdel -r denieduser`.

## Configuration

```bash
cp tests/.env.example tests/.env
```

and fill it in. `tests/.env` is gitignored; never commit credentials. Each variable is described in
`tests/.env.example`. To run against the second host, override the per-host values on the command
line, e.g. `COCKPIT_URL=https://rhel9-test.example.com:9090 COCKPIT_SSH=testuser@rhel9-test.example.com npm test`.

## Running

Install the browsers once:

```bash
npm install
npx playwright install chromium firefox
```

Then:

```bash
npm test               # full suite, Chromium then Firefox
npm run test:chromium  # one browser while iterating
npm run test:firefox
npx playwright test -c tests/playwright.config.js tests/history.spec.js   # one spec
```

`workers: 1` caps the whole run to a single worker, so the two browsers never hit the shared host
and Cockpit session at the same time. The HTML report is written to `tests/report/`, and
screenshots, videos and traces to `tests/screenshots/` (both gitignored).

## Running against another command-line-assistant build

The suite works with every supported build (0.4.2 and newer) and asserts the installed build's own
behaviour; it never skips because of the build. It finds the build with `rpm -q` over `COCKPIT_SSH`,
or else from the About popover's version line. On 0.4.2 and 0.5.0 (no `IsRedHatManagedEndpoint`) it
expects no endpoint line and the Red Hat sentences; on 0.5.2 and newer it expects "Red Hat managed
endpoint". The test hosts are expected to use clad's default (Red Hat) endpoint.

To switch a disposable test host to another build, move the package and its SELinux subpackage
together, then restart clad and check what is installed:

```bash
sudo dnf --showduplicates list command-line-assistant      # what the repos offer
sudo dnf distro-sync command-line-assistant-0.5.0-2.el10 command-line-assistant-selinux-0.5.0-2.el10
sudo systemctl restart clad
rpm -q command-line-assistant command-line-assistant-selinux
busctl --system introspect com.redhat.lightspeed.chat /com/redhat/lightspeed/chat
```

(`dnf downgrade …` or `dnf install …` with the same arguments where distro-sync declines.)
`config.toml` is `%config(noreplace)`: an unmodified one is swapped for the target build's default,
and a modified one is kept (clad 0.3.1's config schema has no `[backend] timeout`, so going back to
0.3.1 with such a file would stop clad from starting). Back it up first.

On a build older than 0.4.2 the page shows "Unsupported version", so only `versions.spec.js`
applies there: `npx playwright test -c tests/playwright.config.js tests/versions.spec.js`. Its first
test asserts that state on the real host; the stubbed tests in the same file need a supported
build. Every other spec fails at `openModule` on such a host, with a message saying so.

`versions.spec.js` also covers the older builds on any supported host by stubbing clad's replies:
`IsRedHatManagedEndpoint` and `IsChatAvailable` answering `UnknownMethod`, rpm reporting 0.3.1, and
`IsRedHatManagedEndpoint` failing with another error.

## How the specs reach states a healthy host can't show

Most states come straight from the real host. For the ones a healthy host cannot produce without
uninstalling packages or breaking the daemon ("not installed", a daemon error), and to keep most
specs from sending real questions, `tests/helpers/socket.js` sits between the page and cockpit-ws
and rewrites Cockpit protocol frames:

- To produce an error state, it rewrites what the page *asks for* (for example, a D-Bus name that
  does not exist), so the reply, and its error text, still come from the real bridge or `clad`.
- Specs that only need *an* answer (layout, Markdown rendering, copy buttons, limits) answer
  `AskQuestion` (and usually `WriteHistory`) locally, so nothing reaches the assistant or the
  user's history. Each spec's header comment says which calls are real.

The rewrite is installed after login and before the module page opens, so only the module page's
own connection is affected.

## The login + navigation pattern

`tests/helpers/cockpit.js` logs in on the Cockpit login page, turns on administrative access on the
shell page, and then navigates the top-level page directly to the module's own URL,
`/cockpit/@localhost/cla/index.html`. The module then runs at the top level, so specs use
`page` directly without hunting through iframes. Turning on administrative access *before* opening
the module matters: doing it afterwards can leave the module's first render without it.
