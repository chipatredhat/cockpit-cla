# cockpit-cla — Design Decisions

This document describes the module as it is built: its architecture, the clad D-Bus API it
uses, and the reasoning behind each UI decision. Every API fact below was verified live with
command-line-assistant 0.5.2-4 on RHEL 9.8 and RHEL 10.2 unless marked otherwise. "Supported
command-line-assistant versions" says what differs in older builds and which of them were tested.

---

## What this is, and why

A Cockpit front end for the RHEL **command-line assistant** (`command-line-assistant` package, the `c`
command, "powered by RHEL Lightspeed"). Sidebar name **"Assistant"**, under **Tools**.

It gives the assistant a web UI without adding a new service or a new way to run commands. It
calls the assistant daemon (`clad`) over the system D-Bus instead of spawning `c`: there is no
shell, no command line to build, and no input that could be interpreted as one. Cockpit supplies
the rest by construction: the user authenticates, TLS comes with it, the module runs as that user,
and the daemon enforces per-user access.

Audience is a field/demo tool first. On a default installation clad sends each question to Red
Hat's service, which needs an RHSM-registered host with egress to Red Hat. The module itself only
talks to the local clad, so with clad pointed at a self-hosted or disconnected endpoint (and
command-line-assistant 0.4.2 or newer), nothing in the module needs egress.

### Stateless, facts as written

This module stores nothing and holds no opinions of its own:

- **No module-owned state anywhere.** No files on the host, and no `localStorage`/`sessionStorage`.
  All conversation state lives in clad; the module only reads and writes clad's history/chat APIs.
  Every view re-queries on load and on refresh.
- **System facts appear as the system wrote them.** OS identity, chat names, timestamps and the
  assistant's text are shown using the source's own terms. The module adds no severity ratings,
  verdicts, scores, summaries of its own, or "importance" reordering.
- **The assistant's answer is shown verbatim and attributed** ("Response from the command-line
  assistant"). Rendered as sanitized markdown, never summarized, trimmed or annotated, and given no
  confidence labels. Commands inside an answer are never turned into "Run" buttons — acting on the
  answer would be the module having an opinion.
- The only text the module writes itself is factual UI chrome: labels, counts, the data-egress
  disclosure, and the trim notice.

---

## Scope

**v1:** Ask, History, and named Chat sessions. This covers the full question/answer + attachment +
systeminfo + history + chat-management surface of the command-line assistant, i.e. as much of it as
meaningfully maps to a web console.

**Deferred (not v1):**
- **"Explain this host problem"** — gather failed-unit / SELinux / journal context automatically and
  ask about it. Genuinely useful, but it is the module deciding what's wrong, which bends the
  no-opinions rule, so it is not planned for v1.
- **Named-chat niceties** beyond create/select/delete (e.g. per-chat descriptions UI).

**Not applicable / nothing to build:**
- **Terminal capture** (`c shell --enable-capture`, the `terminal` question field). It hooks a live
  bash session via a bashrc drop-in to feed terminal output as context. There is no terminal session
  behind a web page, so the `terminal` field is always sent empty.
- **Feedback** (`c feedback`). There is no D-Bus method; the command only prints a notice and an email
  address (`cla-feedback@redhat.com`). The (i) "About" popover shows that text verbatim under its
  own heading, followed by a separate section that links to this module's issue tracker.

**Not built, not planned:**
- **Deep link** into the page (e.g. a URL that opens a given chat or tab).
- **Showing a chat's saved Q&A on the Ask tab.** The Ask tab still shows only what was asked on this
  page view; saved entries are on the History tab.

---

## Backend: the clad D-Bus API (verified live)

**Do not spawn `c`.** Its CLI is a thin client over the `clad` daemon on the **system bus**. The module
calls clad directly with `cockpit.dbus(name, { bus: "system" })` — no superuser, running as the
logged-in user.

Versions found: both RHEL 9.8 and 10.2 ship **`command-line-assistant-0.5.2-4`** and
**`cockpit-bridge-356.2`**, so one codebase serves both. clad is **D-Bus activated** (no enable needed).
Older builds lack some of these methods; see "Supported command-line-assistant versions".

`busctl introspect` of 0.5.2-4 (identical on 9.8 and 10.2, matching upstream source):

```
com.redhat.lightspeed.user     /com/redhat/lightspeed/user
  GetUserId(i euid) -> s user_id

com.redhat.lightspeed.chat     /com/redhat/lightspeed/chat
  AskQuestion(s user_id, a{sv} question) -> a{sv} {message: s}
  CreateChat(s user_id, s name, s description) -> s chat_id
  GetChatId(s user_id, s name) -> s
  IsChatAvailable(s user_id, s name) -> b
  GetAllChatFromUser(s user_id) -> a{sv} {chats: [ {id,name,description,created-at,updated-at,deleted-at} ]}
  GetLatestChatFromUser(s user_id) -> s
  DeleteChatForUser(s user_id, s name)
  DeleteAllChatForUser(s user_id)
  IsRedHatManagedEndpoint() -> b

com.redhat.lightspeed.history  /com/redhat/lightspeed/history
  GetHistory(s user_id) -> a{sv} {histories: [ {chat-name, created-at, question, response} ]}
  GetFilteredConversation(s user_id, s filter, s from_chat) -> a{sv}
  GetFirstConversation(s user_id, s from_chat) / GetLastConversation(...)
  WriteHistory(s chat_id, s user_id, s question, s response)
  ClearHistory(s user_id, s from_chat)
  ClearAllHistory(s user_id)
```

### Ask call sequence (mirrors upstream `commands/chat.py`)

1. `GetUserId(<own uid>)` → `user_id` (a deterministic UUIDv5 per Unix uid). Get the uid from
   `cockpit.user()`.
2. Resolve the target chat: `GetChatId(user_id, name)`, or `CreateChat(user_id, name, description)` if
   it doesn't exist (`IsChatAvailable` to check first).
3. `AskQuestion(user_id, question)`. The `question` a{sv} **must contain all five keys**:
   ```js
   { message:    {t:"s", v: text},
     stdin:      {t:"a{sv}", v:{ stdin:  {t:"s", v:""} }},
     attachment: {t:"a{sv}", v:{ contents:{t:"s", v: ctx}, mimetype:{t:"s", v:"text/plain"} }},
     terminal:   {t:"a{sv}", v:{ output: {t:"s", v:""} }},   // always empty: no terminal behind web
     systeminfo: {t:"a{sv}", v:{ os:{t:"s",v:NAME}, version:{t:"s",v:VERSION_ID},
                                 arch:{t:"s",v:ARCH}, id:{t:"s",v:ID} }} }
   ```
   This exact shape (with empty systeminfo) was sent through the real `cockpit-bridge` `dbus-json3`
   channel on both OSes and returned `[{message:{t:"s",v:"..."}}]`.
4. **`WriteHistory(chat_id, user_id, question_text, answer)` is the module's job.** The daemon does NOT
   persist Q/A; the `c` client writes history itself after AskQuestion. Skip it and nothing is saved.

   **Composition decision: keep question and context separate.** Upstream `c`
   concatenates `message = f"{question} {attachment}"`, trims that to 32k, *also* sends the attachment
   in `attachment.contents`, and stores the combined blob in history. We instead send `message` =
   question only, `attachment` = context, apply the 32k limit to question + context, and store the
   question only in history. This writes *less* and never truncates the question; confirmed it adds no
   module-owned state (no browser storage, no host files — context is transient React state, sent then
   discarded). Accepted risk: context-heavy answers may differ from `c -a file` if the backend weights
   `question` vs `context` differently. Revisit only if answers actually diverge in practice.

### systeminfo (populate it — it's fact, and it matches `c`)

The `c` client fills `systeminfo` from `/etc/os-release` (`NAME`, `VERSION_ID`, `ID`) plus the machine
arch. The module does the same: read `/etc/os-release` with `cockpit.file()` and get arch from
`cockpit.spawn(["uname","-m"])` (or the host info Cockpit already exposes). This is non-sensitive OS
identity, read verbatim — fully compliant with facts-as-written — and sending it gives answers on par
with the CLI.

### Facts that shape the design

- **The backend is stateless.** AskQuestion takes no chat id; each question is answered on its own.
  Upstream interactive mode confirms this — it is just a loop of independent AskQuestion calls and even
  tells the user "the current session does not include running context". "Chats" are only local
  history buckets. **There is no real multi-turn**, so the UI must not imply one.
- **Size limit: 32,000 characters** total (question + context), enforced *client-side* in upstream
  `chat.py` (`MAX_QUESTION_SIZE`); the daemon does not enforce it. The module enforces it: trim the
  **context** (never the question), and say it was trimmed **and which end was kept**. Which end is
  the user's choice: a file read defaults to its **last** characters
  (logs grow at the end), pasted text to its first.
- **History timestamps are the host's local time, with no zone** (verified on both OSes):
  clad stamps `created-at` with a naive `datetime.now()` in the daemon (no `TZ` in `clad.service`),
  so the value is the host's wall clock at write time. Shown verbatim under "Time (host's local time)".
- **`ClearHistory(user, chat)` clears the live chat's entries only** (by the chat id its name
  resolves to). Entries left behind by an earlier, deleted chat of the same name keep showing under
  that name in `GetHistory`, and only `ClearAllHistory` removes them.
- **Latency 1.4–5.5 s** per AskQuestion in testing. Use a cockpit.dbus `timeout` well above default
  (e.g. 120 s) with a spinner.
- **Answers are markdown**, often ending in a `**Sources:**` list of access.redhat.com KB links.
  Render markdown **sanitized** (no raw HTML to the DOM); open links in a new tab.
- **Authorization is per caller uid, enforced by the daemon.** As uid 1000, `GetUserId(0)` and using
  another user's `user_id` both fail with `PermissionError`. No auth logic in the module; never call
  clad with superuser.
- **Admin can disable it per user** via `/usr/share/dbus-1/system.d/com.redhat.lightspeed.conf`. Treat
  a D-Bus AccessDenied on `com.redhat.lightspeed.user` as "disabled for this user", not an error.
- **History is shared with the CLI, per Unix user** (verified both directions, both OSes). `c` writes
  to a chat named `default`; `GetHistory` returns all chats, each tagged `chat-name`; an entry written
  over D-Bus appears in `c history --all`. `sudo c` writes to **root's** history only.
- **No per-entry delete.** Deletion is per chat (`ClearHistory(user, chat)`) or everything
  (`ClearAllHistory`).

---

## Supported command-line-assistant versions

**The floor is command-line-assistant 0.4.2.** Which build a host has depends on its RHEL minor
release and on whether it took the z-stream updates:

| RHEL release | Build | Status |
|---|---|---|
| 9.6 / 10.0 | 0.3.1-1, 0.3.1-3, 0.3.1-6 | **Unsupported.** Grey "Unsupported version" label and an upgrade hint, nothing else |
| 9.7 / 10.1 | 0.4.2-1 | Supported. No `IsRedHatManagedEndpoint` (see below) |
| 9.8 / 10.2 (GA) | 0.5.0-2 | Supported. No `IsRedHatManagedEndpoint` (see below) |
| 9.8 / 10.2 (RHBA-2026:67586 / 67587, 2026-09-15) | 0.5.2-4 | Supported, everything described in this document |
| (upstream only) | 0.5.3 | Not in RHEL. Changes no D-Bus method (source compared, not tested) |

Tested live by installing each of 0.4.2-1, 0.5.0-2 and 0.5.2-4 (with its `-selinux` subpackage) on
RHEL 9.8 and RHEL 10.2, full suite in both browsers, and 0.3.1-6 for the unsupported state. The
9.7/10.1 and 9.6/10.0 hosts themselves were not tested. The RPM has
`Recommends: command-line-assistant >= 0.4.2`.

What differs between builds, as far as this module is concerned:

| | 0.3.1-x | 0.4.2-1, 0.5.0-2 | 0.5.2-4 |
|---|---|---|---|
| `IsChatAvailable` | missing | yes | yes |
| `systeminfo` question key | rejected (`DBusStructureError`) | yes | yes |
| `IsRedHatManagedEndpoint` | missing | missing | yes |
| `c` prints Red Hat's "…may be used to improve Red Hat's products or services." sentences | always | always | only when `IsRedHatManagedEndpoint` is true |

Every other method, signature and reply shape is the same in all of them.

**Capability check, once at load.** The page calls `IsRedHatManagedEndpoint()` alongside
`GetUserId`, and `IsChatAvailable(user, "cockpit")` (a read) once `GetUserId` has answered. A reply of
`org.freedesktop.DBus.Error.UnknownMethod` means "this build does not have it", never a connection
error. `GetUserId`'s result is kept even when a later call fails, so the chat list and History stay
usable in the error state. Genuine failures (anything other than UnknownMethod) still show clad's
message verbatim under "Connection error".

**Older than 0.4.2: "Unsupported version".** Decided from rpm's version
(`rpm -q command-line-assistant`, VERSION compared numerically with 0.4.2) **or** from
`IsChatAvailable` being missing, so it also works when rpm can't be read. The label is grey
"Unsupported version" and the whole body is: "This page needs command-line-assistant 0.4.2 or newer.
Installed: VERSION-RELEASE." (the second sentence only when rpm reported it) and
`sudo dnf upgrade command-line-assistant`. Ask and History are not offered: 0.3.1 also rejects the
`systeminfo` key, never forwards terminal or systeminfo to the backend, and 0.3.1-1/-3 have no
per-user authorization in clad.

**No `IsRedHatManagedEndpoint` (0.4.2, 0.5.0): connected, and the text `c` of that build shows.**
The page is fully usable. `c` before 0.5.2 always prints the Red Hat sentences, so the page does
too: `LEGAL_NOTICE_RHSM` in the legal notice and "Feedback may be used to improve Red Hat's products
or services." in the About feedback section. The About endpoint line is left out: clad gives an
unprivileged caller no way to know the endpoint (`config.toml` is not readable by the user).

**Endpoint line wording (0.5.2 and newer).** It is clad's own answer, shown as such: true →
"Red Hat managed endpoint", false → "Not a Red Hat managed endpoint". clad 0.5.2 answers true only
for the hostnames `cert.console.redhat.com` and `cert.console.stage.redhat.com`, so a
Satellite-proxied endpoint reports false even though its requests reach Red Hat through Satellite;
the page shows that answer, and hides the Red Hat sentences there, exactly as `c` does.

---

## UI

React + PatternFly 6 on the Cockpit Starter Kit stack (esbuild, `pkg/lib` fetched from a pinned
Cockpit commit), with the `@patternfly/*` packages pinned to the versions shipping Cockpit modules
use. Keep `class="ct-page-fill"` on the `src/index.html` mount div: without it the page does not fill
the viewport. The eslint script includes `--ext .js,.jsx`.

Layout:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Assistant  (visible h1)                         [✓ Connected] (i) ← "About"   │
│ powered by RHEL Lightspeed  (muted)                                            │
│ [ Ask ]  [ History ]                          Chat [ cockpit ▾ ] [New] [⋮]     │
├────────────────────────────────────────────────────────────────────────────────┤
│ Ask the command-line assistant                        Saved to chat: cockpit   │
│ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ │ (question)                                                                 │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ 📎 Context attached from /var/log/messages: the last 31,941 of 988,931          │
│    characters will be sent. Read as administrator.          Change  Remove     │
│    Send: (•) The last 31,941 characters  ( ) The first 31,941 characters       │
│ [ Ask ]  Enter to ask, Shift+Enter for a new line. Each question is answered…  │
│ ▸ Add context (paste text or read a file on this host)                         │
│ This feature uses AI technology. … (verbatim)                                  │
│ Interactions may be used to improve Red Hat's products or services. (verbatim) │
│ Also sent with each question: RHEL 9.8 (rhel) · x86_64 (?)  31,941 context +   │
│                                                    59 question / 32,000 chars  │
├────────────────────────────────────────────────────────────────────────────────┤
│ Q: …   (newest first; scrolled into view on Ask)                               │
│ Response from the command-line assistant                              [Copy]   │
│ ── Asked earlier on this page, saved to chat <other> ──                        │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Page header

- Visible PF `Title` h1 "Assistant" (the only h1), muted subtitle "powered by RHEL Lightspeed".
- **The far-right spot always shows the state** as a compact PF `Label`, with the (i) button always
  beside it, in the same place in every state. The label says *what*; the body below the title still
  says what to do or what went wrong:

  | State | Label | Body below the title |
  |---|---|---|
  | loading | grey "Connecting…" | nothing yet |
  | connected | green, check-circle icon, "Connected" | the tabs |
  | not installed | grey "Not installed" | empty state with `dnf install command-line-assistant` |
  | unsupported version (older than 0.4.2) | grey "Unsupported version" | empty state: "This page needs command-line-assistant 0.4.2 or newer. Installed: VERSION-RELEASE." and `sudo dnf upgrade command-line-assistant` |
  | disabled | grey, lock icon, "Disabled" (an administrator's choice, not a fault: not orange/red) | "The administrator has disabled…" empty state |
  | connection error | red, exclamation-circle icon, "Connection error" | danger alert with clad's error text verbatim; tabs shown |

- The (i) is a plain `Button` named **"About"** that opens a `Popover` named "About" (click, Enter or
  Space; not hover; Escape closes). Each line appears only once it is known, never guessed:
  - "Red Hat managed endpoint" / "Not a Red Hat managed endpoint": only when `IsRedHatManagedEndpoint`
    answered. It is asked on its own at load, in parallel with `GetUserId`, so it can be known in the
    error state too; the connected state still needs it (a failure there is a connection error,
    except UnknownMethod: builds before 0.5.2 have no such method, and the line is left out).
  - "command-line-assistant VERSION-RELEASE": whenever `rpm -q` reports it. rpm is asked on its own,
    independent of clad, so the version shows while loading, not installed (if rpm still has it),
    disabled and on error.
  - "cockpit-cla VERSION-RELEASE": this module's own package, whenever
    `rpm -q cockpit-cla` reports it. Asked the same way, on its own and in every
    state. A development install (files copied to `~/.local/share/cockpit/`) has no such package, so
    the line is absent there.
  - A divider (only if any line above is shown), then two sections, each with an h2 `Title` of the
    same size, shown in every state:
    - **"Feedback on the command-line assistant"**: `c feedback`'s text,
      verbatim (`command_line_assistant/commands/feedback.py`, 0.5.2-4, byte-identical on RHEL 9.8 and
      10.2): "Do not include any personal information or other sensitive information in your
      feedback." with " Feedback may be used to improve Red Hat's products or services." appended
      when `IsRedHatManagedEndpoint` returned true, or always on builds without that method (the CLI's
      own rule in each build), then "To submit feedback, use
      the following email address: cla-feedback@redhat.com." with the address as a `mailto:` link (the
      CLI prints it in angle brackets, `<cla-feedback@redhat.com>`; the link replaces the brackets).
    - **"Feedback on this page"**: one link, "Report a problem with this module", to the project's issue
      tracker (`https://github.com/chipatredhat/cockpit-cla/issues`, the metainfo's
      `bugtracker` URL, kept in one constant `ISSUES_URL` beside `FEEDBACK_ADDRESS`). It opens in a new
      tab (`target="_blank" rel="noopener noreferrer"`) with PatternFly's `ExternalLinkAltIcon` after
      the text, as Cockpit shows external links.
  - All strings translatable with `_()`.

### Chat selector (shared across both tabs)

- A dropdown listing the user's chats from `GetAllChatFromUser` (name + created-at, verbatim). Default
  selection is the chat named `cockpit`, created on first use via `CreateChat(user, "cockpit", "Asked
  from the web console")`. The two chats with a fixed role say so in the list: `cockpit` "The web
  console's default chat", `default` "The c command's chat".
- **New** creates a chat (prompt for a name; Create stays disabled until there is one). An existing name is refused
  before `CreateChat` (clad would make a duplicate) with a **Switch to X** action.
- **⋯** offers **Delete only**. The confirm modal counts the chat's entries from `GetHistory` and, when
  there are any, offers a checkbox (ticked by default) "Also clear this chat's N history entries":
  `ClearHistory` then `DeleteChatForUser`. The counts in the follow-up toast are re-read from
  `GetHistory`, so entries `ClearHistory` could not reach (see "Facts") are reported, not hidden.
  **Verified: clad has no rename/update method**, so rename is not offered (delete+recreate would
  discard the chat's history).
- Create and delete are confirmed with a PatternFly toast (`AlertGroup isToast isLiveRegion`,
  auto-dismissed): transient page state, not stored.
- The CLI's own `default` chat is shown and selectable (read/ask), but **never auto-created or hijacked**
  by the module; new UI questions default to `cockpit`.

### Ask tab (default)

- Question textarea, labelled with the target chat ("Saved to chat: X"); the **Ask** button sits
  directly under it, so opening the context editor never moves it.
- **Context is never sent unseen.** While there is any, a
  non-collapsible attachment line right above Ask says where it came from and exactly how much will be
  sent, with **Change** and **Remove**. Context stays attached after Ask, for a follow-up (the backend
  is stateless, so a follow-up means sending the context again), and the line stays with it.
- **Add context** (below the Ask row): one context textarea with "Read a file on this host…" (reveals
  a path field) and Clear. A successful read fills the textarea and collapses the editor. A
  counter ("N context + M question / 32,000 characters") shows only while there is context; numbers
  use the locale's thousands separators. When trimming applies, the attachment line has the
  last/first radio (see "Facts"). A question alone over the limit is the only alert (danger).
- `cockpit.file()`'s `fsread1` channel has no offset/tail option (bridge 356, both OSes), so a file is
  always read whole, up to the 4 MiB `max_read_size`; keeping its last 32,000 characters happens in
  the browser.
- **The context file read uses `superuser: "try"`**, so root-only logs such as `/var/log/secure` are
  readable once administrative access is turned on. It reads as root when
  the session has administrative access and as the user otherwise; a root-only file without it fails
  with the bridge's own "Not permitted…" error, shown as is. This is the **only** superuser use in the
  module. Clad, `/etc/os-release` and the `uname`/`rpm` spawns stay as the user. A file read is all or
  nothing, so the usual concern with `try` (a command that silently returns less data without root,
  such as journal filtering) doesn't apply. After a read, a muted note says how it was read: "Read as administrator." or
  "Read as <user>.", from `cockpit.Superuser.Current` on the internal bus before and after the read.
  If that can't be told (unknown, still starting, or changed mid-read), it says "Read with
  administrative access when available."
- `systeminfo` is attached automatically (see above) — shown read-only as one line under the legal
  text, "Also sent with each question: NAME VERSION_ID (ID) · arch", values verbatim. The "terminal
  output is never sent" sentence is in a popover on that line.
- **Legal text — match upstream `c` exactly** (it is Red Hat's own text, so it is shown as written, not
  paraphrased). Always show `LEGAL_NOTICE`: "This feature uses AI technology. Do not
  include any personal information or other sensitive information in your input." On a Red Hat endpoint
  (`IsRedHatManagedEndpoint`), and always on builds without that method (as their `c` does),
  additionally show `LEGAL_NOTICE_RHSM`: "Interactions may be used to
  improve Red Hat's products or services." After **every** answer, show `ALWAYS_LEGAL_MESSAGE`: "Always
  review AI-generated content prior to use." None are dismissible (remembering a dismissal would be
  state).
- On Ask: spinner → verbatim markdown answer in a card headed "Response from the command-line
  assistant", with Sources and a Copy button → `WriteHistory` into the selected chat.
- **Code blocks.** Every *fenced* code block in an answer (Ask exchanges and History's
  expanded answers alike) has a small plain icon button, "Copy code", in its top-right corner. It copies
  exactly the block's code (no fence markers, no language tag, whitespace as written, nothing added),
  through the same clipboard helper as the answer's Copy (`src/lib/clipboard.js`): same check-mark +
  "Copied" feedback, same error text when the browser gives no clipboard access. Inline code has no
  button. The whole-answer Copy copies the Markdown. **Copy only, never a "Run" button**; the
  button is a React element, so rendering stays free of `innerHTML`.
- Questions accumulate within the session view **newest first**, directly under the Ask box, so an
  answer appears without scrolling; each is an independent call, and helper
  text states that prior turns are not carried as context. On Ask the pending exchange is scrolled
  into view. When exchanges were saved to a chat other than the selected one, a divider says so
  ("Asked earlier on this page, saved to chat Y"). A chat's saved history is **not** loaded into the
  Ask tab; it is on the History tab.
- Accessibility: a polite `role="status"` region announces "Asking…", the answer arriving and errors;
  the pending exchange has `aria-busy`; while waiting, "Asking…" and an elapsed-seconds counter show.
- In the question box, **Enter asks and Shift+Enter inserts a newline**. Enter
  goes through the Ask button's own guard, so it does nothing while Ask is disabled. Context goes in
  the "Add context" area.

### History tab

- Table from `GetHistory` (optionally scoped to the selected chat, "All chats" / "Only X"):
  **Time (host's local time)**, question (expand to the answer, in the same card as the Ask tab, with
  Copy), and **Chat** = `chat-name` verbatim. There is deliberately no "Source" column (e.g. mapping
  `cockpit` → "Web console", `default` → "Command line"): that would be an inference about where a
  question was asked, which clad does not record.
- Search box: **client-side filter over `GetHistory`** (which returns every chat's entries tagged with
  `chat-name`). **Verified: `GetFilteredConversation` is per-chat only** — an empty `from_chat` returns
  nothing and it never crosses chats — so it cannot back a global search. Use it only if a future
  "search within this chat" scope is wanted; the default search is client-side and global.
- **Export** downloads a Markdown file of **exactly the entries the table shows**
  (current scope, search filter and sort order); disabled while no rows are shown. Built in the
  browser (Blob + object URL + `<a download>`): nothing is written on the host, nothing goes to browser
  storage. `GetHistory` entries hold only `chat-name`, `created-at`, `question` and `response`
  (verified: no context/attachment field; for `c` entries the CLI's own question may already include
  its attachment text), so those four are all an entry has, verbatim:
  ```
  # Assistant history

  Host: <uname -n> · Scope: All chats | Chat: `name` · Filter: "<text>" (if set) · N entries

  Exported: <browser's local time, ISO 8601 with UTC offset>

  Times are the host's local time, as the History tab's "Time (host's local time)" column shows them.

  ---

  ## <created-at exactly as the table shows it> · `<chat-name>`

  **Question**

  ````text
  <question verbatim>
  ````

  **Answer**

  ````markdown
  <response verbatim, raw markdown as clad stored it>
  ````
  ```
  Question and answer each sit in a code fence one backtick longer than the longest backtick run in
  them (minimum 3), and the chat name in a code span, so an answer's own ``` fences or # headings (or
  an unclosed fence) cannot end the entry or pass for the file's headings. The text is not altered.
  Filename `assistant-history-<host>-<chat name | all-chats>-<YYYYMMDD-HHMM>.md` (browser local time),
  every character outside `[A-Za-z0-9._-]` replaced by `_`. The host part is left out if `uname -n`
  could not be read.
- **Clear chat X…** (`ClearHistory(user, chat)`; enabled only while the table is scoped to that chat)
  and **Clear all history** (`ClearAllHistory`, which
  also wipes the user's `c` CLI history) — each with a confirm modal stating exactly what is deleted.
  No per-row delete (the API has none).
- Shows only the logged-in user's history. Root's (`sudo c`) history is out of scope.

### About / footer

- Package versions, endpoint and the two feedback sections are in the (i) "About" popover beside the
  status label (see "Page header"). There is no footer.
- **Feedback on the assistant: mirror `c feedback`, nothing more.** The popover shows the CLI's own
  text and Red Hat's address (above). Problems with this web console module itself go to the
  project's issue tracker, through the separate "Feedback on this page" link; the module collects
  nothing itself.

### Status / edge states (standalone-installable rule)

| State | Behavior |
|---|---|
| `command-line-assistant` not installed (D-Bus name not activatable) | Empty state with `dnf install command-line-assistant` and one line on what it is; module still loads; label grey "Not installed" |
| `command-line-assistant` older than 0.4.2 (rpm version, or `IsChatAvailable` → UnknownMethod) | Empty state with the required and installed versions and `sudo dnf upgrade command-line-assistant`; label grey "Unsupported version" |
| `IsRedHatManagedEndpoint` → UnknownMethod (0.4.2, 0.5.0) | Connected; no endpoint line; Red Hat sentences shown, as that build's `c` does |
| clad error / host not registered | Red alert with the daemon's error text; Ask disabled; History still works if reachable; label red "Connection error" |
| `IsRedHatManagedEndpoint() == false` | "Not a Red Hat managed endpoint" in the About popover; no Red Hat sentences |
| D-Bus AccessDenied for this user | "The assistant has been disabled for your account by the administrator."; label grey "Disabled" (lock) |

---

## Packaging

- `noarch` RPM, `BuildArch: noarch`. **Must build and run on el9 and el10.** COPR chroots rhel-9 +
  rhel-10 (or epel-9/10).
- `Requires: cockpit-bridge`. **`Recommends: command-line-assistant >= 0.4.2`** (not Requires) so the
  module installs alone and shows its install-hint (or upgrade-hint) empty state.
- No owned config file, no `/var/lib/cockpit-cla/`, no SELinux `.fc` (no host-side
  state). Revisit only if settings are ever added.

### Network egress

**This module's purpose is to send a question, and any context the user attaches, to the assistant.**
The module itself still makes **no network calls**: it talks only to the local clad daemon; clad
(Red Hat-shipped, RHSM-authenticated) sends the question to the endpoint it is configured for. This is
deliberate, scoped to clad, and mitigated by the always-on disclosure and the visible context
(including systeminfo) before each Ask.

---

## Test targets

Tested on RHEL 9.8 and RHEL 10.2 with Cockpit 356, in Chromium and Firefox (Playwright; see
`TESTING.md`), with each supported `command-line-assistant` build installed in turn: 0.4.2-1, 0.5.0-2
and 0.5.2-4 (full suite), plus 0.3.1-6 for the "Unsupported version" state. Every feature is
verified on both releases, in both browsers, before it is called done. The suite detects the
installed build and asserts that build's behaviour.

**Gotcha when scripting `c` over `ssh host 'bash -s' < script`:** `c` reads stdin as context and
swallows the rest of the script. Always run `c … </dev/null`.
