# Security Policy

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

You can report security issues either by:
- Using GitHub's [private vulnerability reporting](https://github.com/chipatredhat/cockpit-cla/security/advisories/new) (preferred)
- Emailing chip@redhat.com with "cockpit-cla security" in the subject line
- Opening a [GitHub issue](https://github.com/chipatredhat/cockpit-cla/issues) for lower-severity findings

Please include the OS version, `rpm -q cockpit-cla command-line-assistant
cockpit-bridge`, the browser, steps to reproduce, and the potential impact.

## Context and Scope

cockpit-cla is a Cockpit browser UI module that runs locally on a single host.
It is not a network daemon, exposes no services, and makes no network requests itself. It calls the
command-line assistant daemon (`clad`) over the system D-Bus as the logged-in user; `clad`
authorizes each call by the caller's uid and sends questions to the endpoint it is configured for.
The module never spawns a shell or the `c` command and writes no files of its own (it is
deliberately stateless). Its only privileged operation is reading a file the user chose as context,
with Cockpit's `superuser: "try"`, so it reads as root only when the user has turned on
administrative access.

In scope:
- XSS or HTML injection via the assistant's answers, history entries, chat names or other text
  `clad` returns (answers are rendered as sanitized Markdown; see `src/lib/markdown.js` and
  `tests/security.spec.js`)
- Unsafe link handling in rendered answers (e.g. `javascript:` URLs)
- A `clad` call made with superuser, or as anyone other than the logged-in user
- Unintended privilege escalation via the context file read or any other `cockpit.spawn()`/
  `cockpit.file()` call
- Host data being sent without being shown to the user first, or the module writing data to the
  host or to browser storage

Out of scope:
- Vulnerabilities in `clad`/`command-line-assistant`, the `c` command, the assistant's backend
  service, or Cockpit itself — report those upstream (Red Hat products via
  [Red Hat Product Security](https://access.redhat.com/security/team/contact), Cockpit via the
  [Cockpit project](https://github.com/cockpit-project/cockpit/security))
- The content of the assistant's answers (send those to cla-feedback@redhat.com)
- Issues requiring prior compromise of the host or of the user's Cockpit session
