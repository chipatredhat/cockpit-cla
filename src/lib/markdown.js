// SPDX-License-Identifier: LGPL-2.1-or-later
// Minimal markdown parser for the assistant's answers.
//
// Security model: this produces a plain AST of { type, ... } objects whose
// text is only ever rendered as React text nodes (components/Markdown.jsx).
// No HTML string is ever built, so raw HTML in an answer shows up as literal
// text — it can't reach the DOM as markup. Link targets are restricted to
// http(s)/mailto by isSafeUrl(). Images are not loaded (the module makes no
// network requests); they render as links.
//
// Deliberately hand-written instead of bundling a community npm parser — the
// shipped bundle may only contain Red Hat/PatternFly/React code.
//
// Supported: ATX headings, paragraphs, fenced code, bullet/ordered lists
// (nested), blockquotes, thematic breaks, GFM tables; inline code, strong,
// emphasis, links, autolinks, bare URLs, hard line breaks, backslash escapes.

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const LIST_RE = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+(.*))?$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function isSafeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
    } catch (e) {
        return false;
    }
}

const isBlank = line => /^[ \t]*$/.test(line);

function leadingSpaces(line) {
    let n = 0;
    for (const ch of line) {
        if (ch === " ") n++;
        else if (ch === "\t") n += 4 - (n % 4);
        else break;
    }
    return n;
}

// Remove up to `count` columns of leading whitespace.
function stripIndent(line, count) {
    let col = 0;
    let i = 0;
    while (i < line.length && col < count) {
        if (line[i] === " ") col++;
        else if (line[i] === "\t") col += 4 - (col % 4);
        else break;
        i++;
    }
    return line.slice(i);
}

function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\" && s[i + 1] === "|") {
            cur += "|";
            i++;
        } else if (s[i] === "|") {
            cells.push(cur.trim());
            cur = "";
        } else {
            cur += s[i];
        }
    }
    cells.push(cur.trim());
    return cells;
}

function listMarker(line) {
    const m = line.match(LIST_RE);
    if (!m)
        return null;
    const marker = m[2];
    const ordered = /\d/.test(marker[0]);
    const rest = m[3] || "";
    const content = m[4] || "";
    // content offset: indent + marker + 1..4 spaces (or 1 if content is blank or indented code)
    const spaces = rest.length - content.length;
    const pad = (content === "" || spaces > 4) ? 1 : spaces;
    return {
        indent: m[1].length,
        ordered,
        bullet: ordered ? marker[marker.length - 1] : marker,
        start: ordered ? parseInt(marker, 10) : null,
        offset: m[1].length + marker.length + pad,
        content: spaces > 4 ? rest.slice(1) : content,
    };
}

// Can `line` start a block that interrupts a paragraph?
function interruptsParagraph(line) {
    if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line))
        return true;
    const li = listMarker(line);
    return !!(li && li.content !== "" && (!li.ordered || li.start === 1));
}

function parseBlocks(lines) {
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (isBlank(line)) {
            i++;
            continue;
        }

        let m = line.match(FENCE_RE);
        if (m) {
            const fence = m[1];
            const indent = leadingSpaces(line);
            const body = [];
            i++;
            while (i < lines.length) {
                const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
                if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
                    break;
                body.push(stripIndent(lines[i], indent));
                i++;
            }
            i++; // closing fence (or EOF)
            blocks.push({ type: "code", lang: m[2] || "", text: body.join("\n") });
            continue;
        }

        m = line.match(HEADING_RE);
        if (m) {
            blocks.push({ type: "heading", level: m[1].length, children: parseInline(m[2] || "") });
            i++;
            continue;
        }

        if (HR_RE.test(line)) {
            blocks.push({ type: "hr" });
            i++;
            continue;
        }

        if (QUOTE_RE.test(line)) {
            const body = [];
            while (i < lines.length && !isBlank(lines[i])) {
                const q = lines[i].match(QUOTE_RE);
                if (q)
                    body.push(q[1]);
                else if (body.length && !interruptsParagraph(lines[i]))
                    body.push(lines[i]); // lazy continuation
                else
                    break;
                i++;
            }
            blocks.push({ type: "blockquote", children: parseBlocks(body) });
            continue;
        }

        const li = listMarker(line);
        if (li) {
            const list = { type: "list", ordered: li.ordered, start: li.start, loose: false, items: [] };
            let sawBlank = false;
            while (i < lines.length) {
                const cur = listMarker(lines[i]);
                if (!cur || cur.ordered !== li.ordered || cur.bullet !== li.bullet || cur.indent >= li.offset)
                    break;
                if (sawBlank)
                    list.loose = true;
                const body = [cur.content];
                i++;
                sawBlank = false;
                while (i < lines.length) {
                    const l = lines[i];
                    if (isBlank(l)) {
                        sawBlank = true;
                        body.push("");
                        i++;
                        continue;
                    }
                    if (leadingSpaces(l) >= cur.offset) {
                        // a blank line between two blocks of one item makes the list loose
                        if (sawBlank)
                            list.loose = true;
                        body.push(stripIndent(l, cur.offset));
                        sawBlank = false;
                        i++;
                        continue;
                    }
                    if (!sawBlank && !interruptsParagraph(l) && !listMarker(l)) {
                        body.push(l.trim()); // lazy continuation of the item's paragraph
                        i++;
                        continue;
                    }
                    break;
                }
                while (body.length && body[body.length - 1] === "")
                    body.pop();
                list.items.push(parseBlocks(body));
                if (sawBlank && !(i < lines.length && listMarker(lines[i])))
                    break;
            }
            blocks.push(list);
            continue;
        }

        if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]) &&
            lines[i + 1].includes("-")) {
            const header = splitTableRow(line);
            const align = splitTableRow(lines[i + 1]).map(c => {
                const left = c.startsWith(":");
                const right = c.endsWith(":");
                return left && right ? "center" : right ? "right" : left ? "left" : null;
            });
            if (align.length === header.length) {
                i += 2;
                const rows = [];
                while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
                    const cells = splitTableRow(lines[i]);
                    rows.push(header.map((_h, idx) => parseInline(cells[idx] ?? "")));
                    i++;
                }
                blocks.push({ type: "table", align, header: header.map(h => parseInline(h)), rows });
                continue;
            }
        }

        // paragraph
        const para = [line.trim()];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines[i])) {
            para.push(lines[i].replace(/^[ \t]+/, ""));
            i++;
        }
        blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
    }

    return blocks;
}

const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const isWordChar = ch => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isSpace = ch => !ch || /\s/.test(ch);

// Find the index of the `]` matching the `[` at `start`, or -1.
function matchBracket(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
        } else if (text[i] === "`") {
            const run = text.slice(i).match(/^`+/)[0];
            const close = text.indexOf(run, i + run.length);
            if (close !== -1) i = close + run.length - 1;
        } else if (text[i] === "[") {
            depth++;
        } else if (text[i] === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// Parse `(url "title")` at `start`; returns { url, end } or null.
function linkDestination(text, start) {
    if (text[start] !== "(")
        return null;
    let i = start + 1;
    while (text[i] === " ") i++;
    let url = "";
    if (text[i] === "<") {
        const close = text.indexOf(">", i);
        if (close === -1) return null;
        url = text.slice(i + 1, close);
        i = close + 1;
    } else {
        let depth = 0;
        while (i < text.length && !/\s/.test(text[i])) {
            if (text[i] === "(") depth++;
            else if (text[i] === ")") {
                if (depth === 0) break;
                depth--;
            }
            url += text[i];
            i++;
        }
    }
    while (text[i] === " ") i++;
    if (text[i] === '"' || text[i] === "'") {
        const close = text.indexOf(text[i], i + 1);
        if (close === -1) return null;
        i = close + 1;
        while (text[i] === " ") i++;
    }
    if (text[i] !== ")")
        return null;
    return { url, end: i + 1 };
}

// Find a closing emphasis delimiter for `delim`; `from` is where the content
// starts. A closer right at `from` would make empty emphasis, so it doesn't
// count ("****" stays text). The scan itself starts at `from`, so a code span
// that opens the content is skipped as a whole.
function findCloser(text, delim, from) {
    for (let i = from; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "`") {
            const run = text.slice(i).match(/^`+/)[0];
            const close = text.indexOf(run, i + run.length);
            if (close !== -1) {
                i = close + run.length - 1;
                continue;
            }
        }
        if (i > from && text.startsWith(delim, i) && !isSpace(text[i - 1])) {
            // for single-char delimiters, don't close on half of a double one
            if (delim.length === 1 && text[i + 1] === delim) {
                i++;
                continue;
            }
            if (delim[0] === "_" && isWordChar(text[i + delim.length]))
                continue;
            return i;
        }
    }
    return -1;
}

const BARE_URL_RE = /^(?:https?:\/\/|www\.)[^\s<]+/;

function trimUrlTail(url) {
    // drop trailing punctuation, and an unbalanced closing paren
    for (;;) {
        const last = url[url.length - 1];
        if (/[.,:;!?'"*_~]/.test(last)) {
            url = url.slice(0, -1);
        } else if (last === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
            url = url.slice(0, -1);
        } else {
            return url;
        }
    }
}

export function parseInline(text) {
    const out = [];
    let buf = "";
    const flush = () => {
        if (buf) out.push({ type: "text", value: buf });
        buf = "";
    };

    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        if (ch === "\\" && i + 1 < text.length) {
            if (text[i + 1] === "\n") {
                flush();
                out.push({ type: "break" });
                i += 2;
                continue;
            }
            if (PUNCT.includes(text[i + 1])) {
                buf += text[i + 1];
                i += 2;
                continue;
            }
        }

        if (ch === "\n") {
            // two trailing spaces = hard break; otherwise a soft break (a space)
            if (buf.endsWith("  ")) {
                buf = buf.replace(/ +$/, "");
                flush();
                out.push({ type: "break" });
            } else {
                buf = buf.replace(/ +$/, "") + " ";
            }
            i++;
            continue;
        }

        if (ch === "`") {
            const run = text.slice(i).match(/^`+/)[0];
            const close = text.indexOf(run, i + run.length);
            // the closing run must be exactly as long
            if (close !== -1 && text[close + run.length] !== "`") {
                let code = text.slice(i + run.length, close).replace(/\n/g, " ");
                if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim())
                    code = code.slice(1, -1);
                flush();
                out.push({ type: "code", value: code });
                i = close + run.length;
                continue;
            }
            buf += run;
            i += run.length;
            continue;
        }

        if (ch === "<") {
            const m = text.slice(i).match(/^<((?:https?|mailto):[^\s<>]+)>/i);
            if (m) {
                flush();
                out.push({ type: "link", url: m[1], children: [{ type: "text", value: m[1] }] });
                i += m[0].length;
                continue;
            }
        }

        if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
            const image = ch === "!";
            const open = image ? i + 1 : i;
            const close = matchBracket(text, open);
            if (close !== -1) {
                const dest = linkDestination(text, close + 1);
                if (dest) {
                    flush();
                    const label = text.slice(open + 1, close);
                    const children = label ? parseInline(label) : [{ type: "text", value: dest.url }];
                    out.push({ type: "link", url: dest.url, image, children });
                    i = dest.end;
                    continue;
                }
            }
        }

        if ((ch === "h" || ch === "w") && !isWordChar(text[i - 1])) {
            const m = text.slice(i).match(BARE_URL_RE);
            if (m) {
                const raw = trimUrlTail(m[0]);
                if (raw.length > 8) {
                    flush();
                    const url = raw.startsWith("www.") ? "https://" + raw : raw;
                    out.push({ type: "link", url, children: [{ type: "text", value: raw }] });
                    i += raw.length;
                    continue;
                }
            }
        }

        if (ch === "*" || ch === "_") {
            const dbl = text[i + 1] === ch;
            const delim = dbl ? ch + ch : ch;
            const after = text[i + delim.length];
            const leftFlanking = !isSpace(after) && !(ch === "_" && isWordChar(text[i - 1]));
            if (leftFlanking) {
                const close = findCloser(text, delim, i + delim.length);
                if (close !== -1) {
                    flush();
                    out.push({
                        type: dbl ? "strong" : "em",
                        children: parseInline(text.slice(i + delim.length, close)),
                    });
                    i = close + delim.length;
                    continue;
                }
            }
            buf += delim;
            i += delim.length;
            continue;
        }

        if (ch === "~" && text[i + 1] === "~") {
            const close = text.indexOf("~~", i + 2);
            if (close > i + 2) {
                flush();
                out.push({ type: "del", children: parseInline(text.slice(i + 2, close)) });
                i = close + 2;
                continue;
            }
        }

        buf += ch;
        i++;
    }
    flush();
    return out;
}

export function parseMarkdown(text) {
    const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
    return parseBlocks(lines);
}
