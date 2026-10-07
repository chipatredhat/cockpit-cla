// Ask writes into the chat selected in the header, end to end against the
// real clad and backend: create a chat in the UI, ask a real question, find
// the entry in History and with the c command, then clear and delete the chat
// through the UI (which also runs the real ClearHistory).
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, createChatInUi, deleteSelectedChatInUi, uniqueChatName, ssh } = require('./helpers/module.js');

test('a question asked with a newly created chat selected is saved to that chat', async ({ page, browserName }) => {
    test.setTimeout(300000);
    const calls = [];
    const pending = {};
    await openModule(page, {
        toServer: (_channel, body) => {
            const method = callMethod(body);
            if (method) {
                const entry = { method, args: body.call[3] };
                calls.push(entry);
                pending[body.id] = entry;
            }
            return undefined;
        },
        toClient: (_channel, body) => {
            if (body?.id && pending[body.id])
                pending[body.id].reply = body.reply;
            return undefined;
        },
    });

    const name = uniqueChatName(browserName);
    await createChatInUi(page, name);
    const chatId = calls.find(c => c.method === 'CreateChat').reply[0][0];

    const marker = `pw-${browserName}-${Date.now()}`;
    const question = `What does the -Z flag do in ls? Answer in one sentence. (${marker})`;
    await page.fill('#ct-assistant-question', question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const answer = page.locator('.ct-assistant-answer');
    await expect(answer).toBeVisible({ timeout: 120000 });
    await expect(answer.locator('.ct-assistant-history-note')).toHaveText(`Saved to chat ${name}.`);

    // Resolved by name, then written with that chat's id — not cockpit's.
    expect(calls.filter(c => c.method === 'GetChatId').pop().args[1]).toBe(name);
    const write = calls.find(c => c.method === 'WriteHistory');
    expect(write.args[0]).toBe(chatId);
    expect(write.args[2]).toBe(question);
    expect(calls.filter(c => c.method === 'CreateChat')).toHaveLength(1);

    // History shows it under the chat's own name.
    await page.getByRole('tab', { name: 'History' }).click();
    await page.locator('.ct-assistant-history-search input').fill(marker);
    const row = page.locator('.ct-assistant-history-row').filter({ hasText: marker });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ct-assistant-history-chat')).toHaveText(name);

    // The c command sees it in that chat. `--from-chat` only filters together
    // with --last/--first/--filter in 0.5.2 (a c quirk).
    if (process.env.COCKPIT_SSH) {
        const out = ssh(`c --plain history --from-chat '${name}' --last`);
        expect(out).toContain(marker);
        expect(out).toContain(`*From chat: ${name}*`);
    } else {
        test.info().annotations.push({ type: 'note', description: 'COCKPIT_SSH unset: CLI history check not run' });
    }

    // Clean up through the UI: Clear chat (real ClearHistory), then delete it.
    await page.locator('.ct-assistant-history-search input').fill('');
    await expect(page.locator('#ct-assistant-history-scope-chat')).toHaveText(`Only ${name}`);
    await page.click('#ct-assistant-history-scope-chat');
    await expect(page.locator('.ct-assistant-history-count')).toHaveText('1 entry');
    await page.getByRole('button', { name: `Clear chat ${name}…` }).click();
    const modal = page.locator('.ct-assistant-clear-modal');
    await expect(modal).toContainText(`Clear the history of the chat named ${name}?`);
    await modal.getByRole('button', { name: 'Clear chat' }).click();
    await expect(modal).toHaveCount(0);
    expect(calls.filter(c => c.method === 'ClearHistory').map(c => c.args[1])).toEqual([name]);
    expect(calls.filter(c => c.method === 'ClearAllHistory')).toEqual([]);
    await expect(page.locator('.ct-assistant-history-count')).toHaveText('0 entries');

    if (process.env.COCKPIT_SSH) {
        // Gone for the CLI as well.
        let out;
        try {
            out = ssh(`c --plain history --from-chat '${name}' --last 2>&1`);
        } catch (ex) {
            out = String(ex.stdout || '') + String(ex.stderr || '');
        }
        expect(out).not.toContain(marker);
    }

    await deleteSelectedChatInUi(page, name);
});
