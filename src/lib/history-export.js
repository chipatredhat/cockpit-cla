// SPDX-License-Identifier: LGPL-2.1-or-later
// History → a Markdown file, built in the browser and handed to it as a
// download. Nothing is written on the host or kept in browser storage.
//
// Every entry holds exactly what clad's GetHistory returns (chat-name,
// created-at, question, response), verbatim. The question and the answer each
// go inside a code fence longer than any backtick run in them, so a stored
// answer's own ``` fences or # headings stay inside its entry and can never
// be mistaken for the headings this file adds. The text itself is unchanged.
import cockpit from 'cockpit';

const _ = cockpit.gettext;

const pad = (n, width = 2) => String(n).padStart(width, "0");

// Local time with its UTC offset, e.g. 2026-10-07T14:32:05+02:00.
export function isoWithOffset(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function longestRun(text, ch) {
    let longest = 0;
    let run = 0;
    for (const c of text) {
        run = c === ch ? run + 1 : 0;
        longest = Math.max(longest, run);
    }
    return longest;
}

// A fenced block holding `text` exactly. The fence is longer than any run of
// backticks in the text, so nothing in the text can close it.
function fenced(text, info) {
    const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
    return `${fence}${info}\n${text}\n${fence}`;
}

// An inline code span holding `text`, for values inside a heading.
function codeSpan(text) {
    const ticks = "`".repeat(longestRun(text, "`") + 1);
    const space = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${ticks}${space}${text}${space}${ticks}`;
}

// `scope` is null for all chats, or the chat name the table is limited to.
export function historyMarkdown({ hostname, scope, filter, entries, exportedAt }) {
    const facts = [];
    if (hostname)
        facts.push(cockpit.format(_("Host: $0"), hostname));
    facts.push(scope === null ? _("Scope: All chats") : cockpit.format(_("Scope: Chat: $0"), codeSpan(scope)));
    if (filter)
        facts.push(cockpit.format(_("Filter: \"$0\""), filter));
    facts.push(cockpit.format(cockpit.ngettext("$0 entry", "$0 entries", entries.length), entries.length));

    const out = [
        "# " + _("Assistant history"),
        "",
        facts.join(" · "),
        "",
        cockpit.format(_("Exported: $0"), isoWithOffset(exportedAt)),
        "",
        _("Times are the host's local time, as the History tab's \"Time (host's local time)\" column shows them."),
    ];

    for (const e of entries) {
        out.push(
            "",
            "---",
            "",
            cockpit.format("## $0 · $1", e.createdAt, codeSpan(e.chatName)),
            "",
            "**" + _("Question") + "**",
            "",
            fenced(e.question, "text"),
            "",
            "**" + _("Answer") + "**",
            "",
            fenced(e.response, "markdown"),
        );
    }
    return out.join("\n") + "\n";
}

// assistant-history-<host>-<chat or all-chats>-<YYYYMMDD-HHMM>.md, with every
// character outside [A-Za-z0-9._-] replaced by "_".
export function historyFilename({ hostname, scope, exportedAt }) {
    const d = exportedAt;
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const parts = ["assistant-history"];
    if (hostname)
        parts.push(hostname);
    parts.push(scope === null ? "all-chats" : scope, stamp);
    return parts.join("-").replace(/[^A-Za-z0-9._-]/g, "_") + ".md";
}

// Hand `text` to the browser as a file download.
export function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
