// History tab (DESIGN.md "History tab"). One spec reads the real history;
// the rest feed the page a known GetHistory reply (answered locally, see
// helpers/socket.js) so the assertions don't depend on what is in the VM's
// history, and nothing is cleared for real except in chat-ask.spec.js.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule } = require('./helpers/module.js');

const s = v => ({ t: 's', v });
const entry = (chat, at, question, response) =>
    ({ 'chat-name': s(chat), 'created-at': s(at), question: s(question), response: s(response) });

// clad's order is per chat, not by time — the table sorts newest first.
const HISTORY = [
    entry('cockpit', '2026-10-06 10:00:00.000001', 'How do I list SELinux contexts?', 'Use `ls -Z`.'),
    entry('cockpit', '2026-10-06 13:00:00.000001', 'What is firewalld?', 'A **dynamic** firewall daemon.'),
    entry('default', '2026-10-06 12:00:00.000001', 'Show disk usage', 'Run `df -h` to see SELinux-unrelated disk usage.'),
    entry('work', '2026-10-06 11:00:00.000001', 'Restart a unit',
          'Use systemctl.\n\n<img src=x onerror="window.__ctXss=1"> <script>window.__ctXss=2</script>\n\n[x](javascript:window.__ctXss=3)'),
];

const NOT_AVAILABLE = ['com.redhat.lightspeed.history.HistoryNotAvailableError',
    ['Looks like no history was found. Try asking something first!']];

// Answer GetHistory (and, if asked, the clear calls) locally; record every call.
function stubHistory(calls, { histories = HISTORY, empty = false } = {}) {
    return {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method)
                calls.push({ method, args: body.call[3] });
            if (method === 'GetHistory') {
                if (empty)
                    return { error: NOT_AVAILABLE, id: body.id };
                return { reply: [[{ histories: { t: 'aa{sv}', v: histories } }]], id: body.id };
            }
            if (method === 'ClearAllHistory' || method === 'ClearHistory') {
                histories = [];
                empty = true;
                return { reply: [[]], id: body.id };
            }
            return undefined;
        },
    };
}

async function openHistory(page) {
    await page.getByRole('tab', { name: 'History' }).click();
}

const rows = page => page.locator('.ct-assistant-history-row');

test.describe('History tab', () => {
    test('reads the real history: the table holds every entry clad returns', async ({ page }) => {
        let count = null;
        const pending = {};
        await openModule(page, {
            toServer: (_channel, body) => {
                if (callMethod(body) === 'GetHistory')
                    pending[body.id] = true;
                return undefined;
            },
            toClient: (_channel, body) => {
                if (body?.id && pending[body.id])
                    count = body.reply ? body.reply[0][0].histories.v.length : 0;
                return undefined;
            },
        });
        await openHistory(page);
        await expect.poll(() => count).not.toBeNull();
        expect(count).toBeGreaterThan(0); // earlier Ask specs leave entries in the cockpit chat
        await expect(page.locator('.ct-assistant-history-count')).toHaveText(`${count} ${count === 1 ? 'entry' : 'entries'}`);
        await expect(rows(page)).toHaveCount(count);
        // Entries the web console saved show under its chat's name, verbatim.
        await expect(rows(page).locator('.ct-assistant-history-chat', { hasText: /^cockpit$/ })
                .first()).toBeVisible();
    });

    test('table: time, question and Source from chat-name, newest first; answers rendered safely', async ({ page }) => {
        const calls = [];
        await openModule(page, stubHistory(calls));
        await openHistory(page);

        await expect(rows(page)).toHaveCount(4);
        await expect(page.locator('.ct-assistant-history-count')).toHaveText('4 entries');
        await expect(rows(page).locator('.ct-assistant-history-time')).toHaveText([
            '2026-10-06 13:00:00.000001', '2026-10-06 12:00:00.000001',
            '2026-10-06 11:00:00.000001', '2026-10-06 10:00:00.000001',
        ]);
        // Column headers: the time is clad's, in the host's zone (DESIGN.md "Facts");
        // the chat is clad's chat-name as written.
        await expect(page.locator('.ct-assistant-history-table thead th')).toContainText([
            "Time (host's local time)", 'Question', 'Chat',
        ]);
        await expect(rows(page).locator('.ct-assistant-history-chat')).toHaveText([
            'cockpit', 'default', 'work', 'cockpit',
        ]);
        await expect(rows(page).locator('.ct-assistant-history-question')
                .first()).toHaveText('What is firewalld?');

        // Expand: the stored answer, through the same markdown renderer.
        const first = rows(page).first();
        await first.locator('.pf-v6-c-table__toggle button').click();
        const expanded = page.locator('.ct-assistant-history-entry').first();
        await expect(expanded).toBeVisible();
        await expect(expanded.locator('.ct-markdown strong')).toHaveText('dynamic');
        await expect(expanded).toContainText('Response from the command-line assistant');
        await expect(expanded.locator('.ct-assistant-always-review')).toHaveText('Always review AI-generated content prior to use.');
        // The same answer card as the Ask tab, with Copy; the question is not repeated.
        await expect(expanded.locator('.ct-assistant-answer')).toHaveCount(1);
        await expect(expanded.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
        await expect(expanded.locator('.ct-assistant-question')).toHaveCount(0);
        await expect(expanded).not.toContainText('What is firewalld?');

        // The hostile stored answer stays text.
        const hostile = rows(page).filter({ hasText: 'Restart a unit' });
        await hostile.locator('.pf-v6-c-table__toggle button').click();
        const md = page.locator('.ct-assistant-history-entry').filter({ hasText: 'Use systemctl.' })
                .locator('.ct-markdown');
        await expect(md).toContainText('<img src=x onerror="window.__ctXss=1">');
        await expect(md).toContainText('<script>window.__ctXss=2</script>');
        await expect(md.locator('img, script, [onerror], a[href^="javascript:"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__ctXss)).toBeUndefined();

        // Asked for by the logged-in user's own clad user id.
        const asked = calls.filter(c => c.method === 'GetHistory');
        expect(asked).toHaveLength(1);
        expect(asked[0].args[0]).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('search is client-side and global across chats', async ({ page }) => {
        const calls = [];
        await openModule(page, stubHistory(calls));
        await openHistory(page);
        await expect(rows(page)).toHaveCount(4);
        const search = page.locator('.ct-assistant-history-search input');

        // Case-insensitive, over questions and answers, from different chats.
        await search.fill('selinux');
        await expect(rows(page).locator('.ct-assistant-history-chat')).toHaveText(['default', 'cockpit']);
        await expect(page.locator('.ct-assistant-history-count')).toHaveText('Showing 2 of 4 entries');

        await search.fill('no such text anywhere');
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByText('No entries match the search')).toBeVisible();
        await expect(page.locator('.ct-assistant-history-count')).toHaveText('Showing 0 of 4 entries');

        await search.fill('');
        await expect(rows(page)).toHaveCount(4);

        // Never the per-chat server-side filter; one GetHistory per view.
        expect(calls.filter(c => c.method === 'GetFilteredConversation')).toEqual([]);
        expect(calls.filter(c => c.method === 'GetHistory')).toHaveLength(1);
    });

    test('scoped to the selected chat', async ({ page }) => {
        await openModule(page, stubHistory([]));
        await openHistory(page);
        await page.click('#ct-assistant-history-scope-chat');
        await expect(page.locator('#ct-assistant-history-scope-chat')).toHaveText('Only cockpit');
        await expect(rows(page).locator('.ct-assistant-history-chat')).toHaveText(['cockpit', 'cockpit']);
        await expect(page.locator('.ct-assistant-history-count')).toHaveText('2 entries');
        await page.click('#ct-assistant-history-scope-all');
        await expect(rows(page)).toHaveCount(4);
    });

    test('no history: empty state', async ({ page }) => {
        await openModule(page, stubHistory([], { empty: true }));
        await openHistory(page);
        await expect(page.locator('.ct-assistant-history-empty')).toContainText('No history');
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Clear all history' })).toBeDisabled();
    });

    test('Clear chat: only while scoped to that chat; confirm names it; cancel clears nothing', async ({ page }) => {
        const calls = [];
        await openModule(page, stubHistory(calls));
        await openHistory(page);
        const clear = page.getByRole('button', { name: 'Clear chat cockpit…' });

        // Under "All chats" the button would not match what is shown: disabled, and says why.
        await expect(clear).toBeDisabled();
        await clear.hover();
        await expect(page.getByRole('tooltip')).toHaveText('Select Only cockpit to clear that chat.');
        await clear.click({ force: true });
        await expect(page.locator('.ct-assistant-clear-modal')).toHaveCount(0);

        await page.click('#ct-assistant-history-scope-chat');
        await expect(clear).toBeEnabled();
        await clear.click();
        const modal = page.locator('.ct-assistant-clear-modal');
        await expect(modal).toContainText('Clear the history of the chat named cockpit?');
        await expect(modal).toContainText("This removes every entry in the chat named cockpit from your history, including ones asked with the c command. The chat is kept. The text stays in the assistant's database on this host, readable only by root.");
        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).toHaveCount(0);
        expect(calls.filter(c => c.method === 'ClearHistory' || c.method === 'ClearAllHistory')).toEqual([]);
        await expect(rows(page)).toHaveCount(2);
        await page.click('#ct-assistant-history-scope-all');
        await expect(rows(page)).toHaveCount(4);
    });

    test('Clear all history: confirm says it also removes the c command history', async ({ page }) => {
        const calls = [];
        await openModule(page, stubHistory(calls));
        await openHistory(page);
        await page.getByRole('button', { name: 'Clear all history' }).click();
        const modal = page.locator('.ct-assistant-clear-modal');
        await expect(modal).toContainText('Clear all history?');
        await expect(modal).toContainText("This removes all of your entries from every chat, including the c command's history. Your chats are kept. The text stays in the assistant's database on this host, readable only by root.");

        await modal.getByRole('button', { name: 'Cancel' }).click();
        expect(calls.filter(c => c.method === 'ClearAllHistory')).toEqual([]);

        // Confirm (answered locally: the user's real CLI history is left alone).
        await page.getByRole('button', { name: 'Clear all history' }).click();
        await modal.getByRole('button', { name: 'Clear all history' }).click();
        await expect(modal).toHaveCount(0);
        const cleared = calls.filter(c => c.method === 'ClearAllHistory');
        expect(cleared).toHaveLength(1);
        expect(cleared[0].args[0]).toBe(calls.find(c => c.method === 'GetHistory').args[0]);
        // Re-read from clad afterwards.
        await expect(page.locator('.ct-assistant-history-empty')).toContainText('No history');
        expect(calls.filter(c => c.method === 'GetHistory').length).toBeGreaterThan(1);
    });
});
