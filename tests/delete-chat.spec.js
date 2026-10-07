// Delete chat also clears the chat's history entries when its checkbox is
// ticked: ClearHistory, then DeleteChatForUser, with the
// count taken from GetHistory. Against the real clad: the spec writes one
// real history entry (AskQuestion is answered locally, so nothing reaches the
// backend) into a chat it creates, and the delete removes both.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, createChatInUi, uniqueChatName, localAsk, ssh } = require('./helpers/module.js');

test('deleting a chat with "also clear" clears its entries, then deletes it', async ({ page, browserName }) => {
    const backend = localAsk(() => 'Local answer for the delete test.', { writeHistory: 'real' });
    const calls = [];
    const pending = {};
    await openModule(page, {
        ...backend.route,
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
            if (body?.id && pending[body.id]) {
                pending[body.id].reply = body.reply;
                pending[body.id].error = body.error;
            }
            return undefined;
        },
    });

    const name = uniqueChatName(browserName);
    await createChatInUi(page, name);
    const marker = `pw-m7-${browserName}-${Date.now()}`;
    await page.fill('#ct-assistant-question', `delete test (${marker})`);
    await page.locator('.ct-assistant-actions button[type="submit"]').click();
    await expect(page.locator('.ct-assistant-history-note').first()).toHaveText(`Saved to chat ${name}.`);
    const write = calls.find(c => c.method === 'WriteHistory');
    await expect.poll(() => write.reply || write.error).toBeTruthy();
    expect(write.error).toBeUndefined();

    // The real history now holds the entry, under the chat's name.
    await page.getByRole('tab', { name: 'History' }).click();
    await page.locator('.ct-assistant-history-search input').fill(marker);
    await expect(page.locator('.ct-assistant-history-row')).toHaveCount(1);
    await expect(page.locator('.ct-assistant-history-chat')).toHaveText(name);

    // The dialog counts the chat's entries and offers to clear them (ticked).
    await page.getByRole('button', { name: 'Chat actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete chat…' }).click();
    const modal = page.locator('.ct-assistant-delete-chat-modal');
    const box = modal.getByRole('checkbox', { name: "Also clear this chat's 1 history entry" });
    await expect(box).toBeChecked();
    // Unticked, it says what is left behind.
    await box.uncheck();
    await expect(modal).toContainText('The entries are kept and still appear in History. Once the chat is deleted, only Clear all history removes them.');
    await box.check();
    await expect(modal).not.toContainText('The entries are kept');

    const before = calls.length;
    await modal.getByRole('button', { name: 'Delete chat' }).click();
    await expect(modal).toHaveCount(0);

    // ClearHistory(name) first, then DeleteChatForUser(name); nothing else cleared.
    const after = calls.slice(before).filter(c => ['ClearHistory', 'DeleteChatForUser', 'ClearAllHistory'].includes(c.method));
    expect(after.map(c => [c.method, c.args[1]])).toEqual([['ClearHistory', name], ['DeleteChatForUser', name]]);
    await expect(page.locator('.ct-assistant-toasts .pf-v6-c-alert')
            .filter({ hasText: `Removed the chat named ${name} and its 1 history entry. Now using cockpit.` })).toBeVisible();
    await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText('cockpit');

    // Gone from the real history and from the chat list.
    await page.getByRole('button', { name: 'Refresh history' }).click();
    await expect(page.locator('.ct-assistant-history-row')).toHaveCount(0);
    await page.click('#ct-assistant-chat-toggle');
    await expect(page.getByRole('option', { name: new RegExp('^' + name + '(\\s|$)') })).toHaveCount(0);
    await page.keyboard.press('Escape');

    if (process.env.COCKPIT_SSH) {
        let out;
        try {
            out = ssh(`c --plain history --filter '${marker}' 2>&1`);
        } catch (ex) {
            out = String(ex.stdout || '') + String(ex.stderr || '');
        }
        expect(out).not.toContain(marker);
    } else {
        test.info().annotations.push({ type: 'note', description: 'COCKPIT_SSH unset: CLI history check not run' });
    }
});
