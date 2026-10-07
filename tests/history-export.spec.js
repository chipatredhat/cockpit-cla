// History → Export: a Markdown download of exactly the entries
// the table shows (scope, search and sort), each verbatim from GetHistory.
// GetHistory is answered locally with known entries (helpers/socket.js), so
// nothing is read from or written to the VM's real history.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, ssh } = require('./helpers/module.js');

const s = v => ({ t: 's', v });
const entry = (chat, at, question, response) =>
    ({ 'chat-name': s(chat), 'created-at': s(at), question: s(question), response: s(response) });

// Answers with their own fences and headings, which must stay inside their
// entry, and one with a fence that is never closed.
const HISTORY = [
    entry('cockpit', '2026-10-06 10:00:00.000001', 'How do I list SELinux contexts?',
          'Use `ls -Z`.\n\n````\nan unclosed fence of four\n\n## 2026-01-01 00:00:00 · `fake`\n'),
    entry('cockpit', '2026-10-06 13:00:00.000001', 'What is firewalld?',
          '# firewalld\n\nA **dynamic** firewall daemon.\n\n```bash\nfirewall-cmd --state\n```\n\n---\n\n## Sources\n\n* https://access.redhat.com/'),
    entry('default', '2026-10-06 12:00:00.000001', 'Show disk usage with `df`\n\nand ```` fences', 'Run `df -h`.'),
    entry('work', '2026-10-06 11:00:00.000001', 'Restart a unit', 'Use systemctl.   \n\ttrailing whitespace kept\n'),
];
const plain = HISTORY.map(h => ({
    chatName: h['chat-name'].v, createdAt: h['created-at'].v, question: h.question.v, response: h.response.v,
}));

const TIMES_NOTE = "Times are the host's local time, as the History tab's \"Time (host's local time)\" column shows them.";

function stubHistory(opens) {
    return {
        toServer: (channel, body) => {
            if (channel === '' && body.command === 'open')
                opens.push(body.payload);
            return undefined;
        },
        answer: (_channel, body) => (callMethod(body) === 'GetHistory'
            ? { reply: [[{ histories: { t: 'aa{sv}', v: HISTORY } }]], id: body.id }
            : undefined),
    };
}

const rows = page => page.locator('.ct-assistant-history-row');

// The entries in the exported file, by the headings and fences the module
// writes. A fence is closed only by the same run of backticks, so the
// answer's own fences and headings cannot end an entry early.
function parseEntries(text) {
    const re = /\n---\n\n## (.+?) · (`+) ?(.*?) ?\2\n\n\*\*Question\*\*\n\n(`{3,})text\n([\s\S]*?)\n\4\n\n\*\*Answer\*\*\n\n(`{3,})markdown\n([\s\S]*?)\n\6(?=\n)/g;
    const out = [];
    let m;
    let rest = text;
    while ((m = re.exec(text)) !== null) {
        out.push({ createdAt: m[1], chatName: m[3], question: m[5], response: m[7] });
        rest = rest.replace(m[0], '');
    }
    return { entries: out, outside: rest };
}

async function exportShown(page, opens) {
    const before = opens.length;
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    // Built in the browser: no channel to the host was opened for it.
    expect(opens.slice(before)).toEqual([]);
    return { filename: download.suggestedFilename(), text };
}

// The table as shown, top to bottom.
async function shownRows(page) {
    const times = await rows(page).locator('.ct-assistant-history-time')
            .allTextContents();
    const questions = await rows(page).locator('.ct-assistant-history-question')
            .allTextContents();
    const chats = await rows(page).locator('.ct-assistant-history-chat')
            .allTextContents();
    return times.map((t, i) => ({ createdAt: t, question: questions[i], chatName: chats[i] }));
}

// The exported entries are the shown rows, in order, each with clad's answer verbatim.
async function expectMatchesTable(page, text) {
    const shown = await shownRows(page);
    const { entries, outside } = parseEntries(text);
    expect(entries.map(e => ({ createdAt: e.createdAt, question: e.question, chatName: e.chatName })))
            .toEqual(shown);
    for (const e of entries)
        expect(e).toEqual(plain.find(p => p.createdAt === e.createdAt));
    // Outside the entries there are only the file's own header lines.
    expect(outside.split('\n').filter(l => l.startsWith('#'))).toEqual(['# Assistant history']);
    return entries;
}

function expectHeader(text, { host, facts }) {
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Assistant history');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe([`Host: ${host}`, ...facts].join(' · '));
    expect(lines[4]).toMatch(/^Exported: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    const exported = Date.parse(lines[4].slice('Exported: '.length));
    expect(Math.abs(Date.now() - exported)).toBeLessThan(5 * 60 * 1000);
    expect(lines[6]).toBe(TIMES_NOTE);
    expect(text.endsWith('\n')).toBe(true);
}

function filenameRe(host, scope) {
    const h = host.replace(/[^A-Za-z0-9._-]/g, '_').replace(/[.]/g, '\\.');
    return new RegExp(`^assistant-history-${h}-${scope}-\\d{8}-\\d{4}\\.md$`);
}

test.describe('History export', () => {
    let host;

    test.beforeEach(async ({ page }) => {
        const opens = [];
        page.opens = opens;
        await openModule(page, stubHistory(opens));
        await page.getByRole('tab', { name: 'History' }).click();
        await expect(rows(page)).toHaveCount(4);
        // The host name, as uname -n reports it on the VM.
        host = process.env.COCKPIT_SSH ? ssh('uname -n').trim() : null;
    });

    test('All chats: every shown entry, newest first, verbatim', async ({ page }) => {
        const { filename, text } = await exportShown(page, page.opens);
        const name = host ?? text.split('\n')[2].match(/^Host: (\S+)/)[1];
        expect(filename).toMatch(filenameRe(name, 'all-chats'));
        expect(filename).toMatch(/^[A-Za-z0-9._-]+$/);
        expectHeader(text, { host: name, facts: ['Scope: All chats', '4 entries'] });
        const entries = await expectMatchesTable(page, text);
        expect(entries.map(e => e.createdAt)).toEqual([
            '2026-10-06 13:00:00.000001', '2026-10-06 12:00:00.000001',
            '2026-10-06 11:00:00.000001', '2026-10-06 10:00:00.000001',
        ]);
        // The answer's own heading and fences are inside its fence, untouched.
        expect(text).toContain('````markdown\n# firewalld\n');
        expect(text).toContain('`````text\nShow disk usage with `df`\n\nand ```` fences\n`````');
    });

    test('a single chat: only that chat\'s entries', async ({ page }) => {
        await page.locator('#ct-assistant-history-scope-chat').click();
        await expect(rows(page)).toHaveCount(2);
        const { filename, text } = await exportShown(page, page.opens);
        const name = host ?? text.split('\n')[2].match(/^Host: (\S+)/)[1];
        expect(filename).toMatch(filenameRe(name, 'cockpit'));
        expectHeader(text, { host: name, facts: ['Scope: Chat: `cockpit`', '2 entries'] });
        const entries = await expectMatchesTable(page, text);
        expect(entries.map(e => e.chatName)).toEqual(['cockpit', 'cockpit']);
    });

    test('a search filter: only the matching entries, and the filter is named', async ({ page }) => {
        await page.getByRole('textbox', { name: 'Search history' }).fill('firewall');
        await expect(rows(page)).toHaveCount(1);
        const { filename, text } = await exportShown(page, page.opens);
        const name = host ?? text.split('\n')[2].match(/^Host: (\S+)/)[1];
        expect(filename).toMatch(filenameRe(name, 'all-chats'));
        expectHeader(text, { host: name, facts: ['Scope: All chats', 'Filter: "firewall"', '1 entry'] });
        const entries = await expectMatchesTable(page, text);
        expect(entries.map(e => e.question)).toEqual(['What is firewalld?']);
    });

    test('the table\'s sort order is the file\'s order', async ({ page }) => {
        await page.locator('.ct-assistant-history-table thead th').filter({ hasText: 'Question' })
                .getByRole('button')
                .click();
        await expect(rows(page).first()
                .locator('.ct-assistant-history-question')).toHaveText('How do I list SELinux contexts?');
        const { text } = await exportShown(page, page.opens);
        const entries = await expectMatchesTable(page, text);
        expect(entries.map(e => e.question)).toEqual(plain.map(p => p.question).sort((a, b) => a.localeCompare(b)));
    });

    test('no rows shown: Export is disabled', async ({ page }) => {
        const exportButton = page.getByRole('button', { name: 'Export', exact: true });
        await expect(exportButton).toBeEnabled();
        await page.getByRole('textbox', { name: 'Search history' }).fill('no entry has this text');
        await expect(page.locator('.ct-assistant-history')).toContainText('No entries match the search');
        await expect(exportButton).toBeDisabled();
    });
});
