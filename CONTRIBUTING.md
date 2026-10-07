# Contributing to cockpit-cla

Thanks for your interest in contributing. cockpit-cla gives the RHEL
command-line assistant a native page in the Cockpit web console. Contributions of any size are
welcome.

## Good first contributions

Not sure where to start? These areas are approachable without deep knowledge of the codebase:

- **Bug reports** for the web console page (see below; problems with the assistant's answers go to
  Red Hat instead)
- **Documentation**: typos, unclear steps, missing examples
- **Translations**: strings are marked with `_()` and `po/` has the extraction infrastructure wired
  up, but no `<lang>.po` files yet
- **UI polish**: small visual improvements that follow the existing PatternFly 6 patterns

For larger features, open an issue first to discuss scope before investing time in an
implementation. [DESIGN.md](DESIGN.md) lists what is deliberately out of scope, and the rules a
change has to keep (stateless, facts as written, no chatbot).

## Requirements

Meaningful testing needs a **real RHEL 9 or RHEL 10 host** with `command-line-assistant` installed
and registered with Red Hat, and Cockpit. The module only talks to the `clad` daemon over D-Bus,
and its behaviour (authorization, history, chats, error texts) comes from the real daemon, so there
is no useful way to mock it locally. Changes are expected to work on both RHEL 9 and RHEL 10.

## Getting the code

```bash
git clone https://github.com/chipatredhat/cockpit-cla.git
cd cockpit-cla
```

## Development workflow

The module is React 18 + PatternFly 6, bundled with esbuild, on the
[Cockpit Starter Kit](https://github.com/cockpit-project/starter-kit) layout.

```bash
npm install
make
```

**Install for development** (no system files touched; symlinks `dist/` into your user-local
Cockpit package path):

```bash
make devel-install
```

Cockpit serves `~/.local/share/cockpit/` with higher priority than the system path, so the page at
`https://<host>:9090/cla` now runs your build. To work on a remote test host instead, copy the
build there:

```bash
rsync -a --delete dist/ <user>@<host>:~/.local/share/cockpit/cla/
```

```bash
make watch           # rebuilds dist/ on save; a browser refresh picks up the change
make devel-uninstall # removes the symlink
```

Before opening a pull request:

```bash
npm run eslint
npm run stylelint
make codecheck       # Cockpit's static code checks
```

## Testing

A real, assertion-based Playwright suite lives under `tests/`. See [TESTING.md](TESTING.md) for the
hosts and accounts it needs and how to run it.

```bash
npm test               # full suite, Chromium + Firefox
npm run test:chromium  # single browser, faster while iterating
```

Tests need `tests/.env` (gitignored, copy `tests/.env.example`) pointing at a real host. Never
commit credentials.

## Code conventions

- **Talk to `clad` over D-Bus, never spawn `c`.** All calls go through `src/lib/clad.js` with
  `cockpit.dbus(..., { bus: "system" })`.
- **Never call `clad` with `superuser`.** The daemon authorizes by the caller's uid; as root the
  module would act on root's identity and history. The only superuser use is reading a context file,
  with `superuser: "try"` (see DESIGN.md).
- **Stateless by design.** No files on the host, no settings, no `localStorage`/`sessionStorage`.
  Every view re-reads `clad`. Don't add persistence without discussing it first.
- **Facts as written.** System data and the assistant's answer are shown verbatim, with no ratings,
  verdicts, summaries or reordering of the module's own, and no "Run this command" buttons.
- **Sanitized Markdown only.** Answers are rendered by `src/lib/markdown.js` into React elements; no
  raw HTML from the backend reaches the DOM (`tests/security.spec.js` covers this).
- **The module makes no network requests.** `clad` does the egress.
- PatternFly 6 components, and colors from PatternFly tokens only (stylelint enforces this). All
  user-visible strings go through `_()`.

## File structure

```
cockpit-cla/
├── src/
│   ├── app.jsx                  # Page header, status, tabs, chat selection
│   ├── index.jsx, index.html    # Entry point
│   ├── manifest.json            # Cockpit module manifest (sidebar "Assistant")
│   ├── app.scss                 # Layout and PatternFly overrides
│   ├── components/
│   │   ├── AskTab.jsx           # Question, context, limit, answers
│   │   ├── HistoryTab.jsx       # History table, search, export, clear
│   │   ├── ChatSelector.jsx     # Chat dropdown, New, Delete
│   │   ├── Exchange.jsx         # A question and its answer card
│   │   ├── Markdown.jsx         # Renders parsed Markdown as React elements
│   │   ├── StatusBanner.jsx     # Status label, About popover, edge states
│   │   └── Legal.jsx            # The assistant's legal notices, verbatim
│   └── lib/
│       ├── clad.js              # clad D-Bus calls
│       ├── markdown.js          # Markdown parser (no HTML output)
│       ├── limits.js            # 32,000-character limit and trimming
│       ├── host-info.js         # systeminfo, rpm version, context file read
│       ├── history-export.js    # History → Markdown export
│       └── clipboard.js         # Copy helper
├── tests/                       # Playwright suite (see TESTING.md)
├── packaging/                   # RPM spec and Arch PKGBUILD templates
└── Makefile                     # Build, install, dist and RPM targets
```

## Submitting changes

1. Fork the repository and create a branch for your change
2. Run the relevant Playwright spec(s) against a real RHEL 9 and RHEL 10 host before opening a PR
3. Open a pull request with a clear description of what the change does and why
4. Include a screenshot or screen recording for any UI change

## Reporting bugs

Open a [GitHub issue](https://github.com/chipatredhat/cockpit-cla/issues) with:

- OS version (`cat /etc/redhat-release`)
- `rpm -q cockpit-cla command-line-assistant cockpit-bridge`
- Steps to reproduce
- What you expected vs. what happened
- Browser and its console output if relevant (F12 → Console)

Problems with the content of the assistant's answers are not bugs in this module: send them to
Red Hat at cla-feedback@redhat.com (what `c feedback` prints).

## License

cockpit-cla is licensed under the
[GNU Lesser General Public License v2.1 or later](LICENSE).
