// SPDX-License-Identifier: LGPL-2.1-or-later
// Question + context size limit. The daemon does not enforce it; upstream
// commands/chat.py does it client-side (MAX_QUESTION_SIZE = 32_000, counted in
// Python characters, i.e. code points). We count the same way, and trim the
// context — never the question. Which end of the context is kept is the
// user's choice ("first" or "last"); the module only offers a default.
import cockpit from 'cockpit';

export const MAX_TOTAL_CHARS = 32000;

function isSurrogatePair(str, i) {
    const c = str.charCodeAt(i);
    if (c < 0xD800 || c > 0xDBFF || i + 1 >= str.length)
        return false;
    const d = str.charCodeAt(i + 1);
    return d >= 0xDC00 && d <= 0xDFFF;
}

export function charCount(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
        if (isSurrogatePair(str, i))
            i++; // count a surrogate pair once
        n++;
    }
    return n;
}

// The UTF-16 index just after the first `count` code points.
function indexAfter(str, count) {
    let n = 0;
    let i = 0;
    while (i < str.length && n < count) {
        i += isSurrogatePair(str, i) ? 2 : 1;
        n++;
    }
    return i;
}

// Counts as the user reads them, with the locale's thousands separators.
export function formatCount(n) {
    const lang = cockpit.language ? cockpit.language.replace('_', '-') : undefined;
    try {
        return n.toLocaleString(lang);
    } catch (ex) {
        return n.toLocaleString();
    }
}

// Returns what will actually be sent and whether the context was cut.
//   keep: "first" or "last" — which end of the context survives a trim
//   questionTooLong: the question alone exceeds the limit (never trimmed)
export function fitToLimit(question, context, keep = "first") {
    const questionChars = charCount(question);
    const contextChars = charCount(context);
    const total = questionChars + contextChars;
    const whole = { total, questionChars, trimmed: false, keep, context, contextChars, sentContextChars: contextChars };
    if (questionChars > MAX_TOTAL_CHARS)
        return { ...whole, questionTooLong: true };
    if (total <= MAX_TOTAL_CHARS)
        return { ...whole, questionTooLong: false };
    const room = MAX_TOTAL_CHARS - questionChars;
    return {
        ...whole,
        questionTooLong: false,
        trimmed: true,
        context: keep === "last"
            ? context.slice(indexAfter(context, contextChars - room))
            : context.slice(0, indexAfter(context, room)),
        sentContextChars: room,
    };
}
