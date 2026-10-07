// Chat selector (DESIGN.md "Chat selector"), against the real clad. Chats the
// specs create are named pw-<browser>-<time> and deleted again by the spec.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const {
    openModule, chatOption, selectChat, createChatInUi, deleteSelectedChatInUi, uniqueChatName, ssh
} = require('./helpers/module.js');

// Record every clad call the page makes, and clad's replies, without changing them.
function observe(calls) {
    const pending = {};
    return {
        toServer: (_channel, body) => {
            const method = callMethod(body);
            if (method) {
                const entry = { method, args: body.call[3] };
                calls.push(entry);
                if (body.id)
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
    };
}

test.describe('chat selector', () => {
    test('defaults to the cockpit chat; default is listed and selectable but never created', async ({ page }) => {
        const calls = [];
        await openModule(page, observe(calls));

        await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText('cockpit');
        await page.click('#ct-assistant-chat-toggle');
        // The CLI's own chat exists on the test VMs (c has been run there).
        await expect(chatOption(page, 'default')).toBeVisible();
        await expect(chatOption(page, 'default')).toContainText(/The c command's chat\. Created \d{4}-\d{2}-\d{2} /);
        await expect(chatOption(page, 'cockpit')).toContainText("The web console's default chat.");
        await page.keyboard.press('Escape');

        await selectChat(page, 'default');
        await page.getByRole('tab', { name: 'History' }).click();
        await page.getByRole('tab', { name: 'Ask' }).click();
        await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText('default');

        // Loading, listing and selecting created nothing: the page never
        // creates a chat on its own, least of all "default".
        expect(calls.filter(c => c.method === 'CreateChat')).toEqual([]);
        expect(calls.filter(c => c.method === 'DeleteChatForUser')).toEqual([]);
        expect(calls.some(c => c.method === 'GetAllChatFromUser')).toBe(true);
    });

    test('create, select and delete a named chat', async ({ page, browserName }) => {
        const calls = [];
        await openModule(page, observe(calls));
        const name = uniqueChatName(browserName);

        await createChatInUi(page, name);
        const create = calls.find(c => c.method === 'CreateChat');
        expect(create.args[1]).toBe(name);
        expect(create.reply[0][0]).toMatch(/^[0-9a-f-]{36}$/);

        // Listed by clad with its creation time, and shown as the selection.
        await page.click('#ct-assistant-chat-toggle');
        await expect(chatOption(page, name)).toContainText(/Created \d{4}-\d{2}-\d{2} /);
        await page.keyboard.press('Escape');

        if (process.env.COCKPIT_SSH) {
            const out = ssh('busctl --system --json=short call com.redhat.lightspeed.chat /com/redhat/lightspeed/chat ' +
                            'com.redhat.lightspeed.chat IsChatAvailable ss ' + create.args[0] + ' ' + name);
            expect(JSON.parse(out).data[0]).toBe(true);
        }

        // Switch away and back.
        await selectChat(page, 'cockpit');
        await selectChat(page, name);

        // Delete: the confirmation names the chat and counts its entries
        // (a new chat has none, so there is nothing to offer to clear).
        await page.getByRole('button', { name: 'Chat actions' }).click();
        const del = page.getByRole('menuitem', { name: 'Delete chat…' });
        await expect(del).toBeEnabled();
        await expect(page.getByRole('menuitem', { name: /rename/i })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Chat actions' }).click();
        await del.click();
        const modal = page.locator('.ct-assistant-delete-chat-modal');
        await expect(modal).toContainText(`Delete the chat named ${name}?`);
        await expect(modal).toContainText(`This removes the chat named ${name}.`);
        await expect(modal).toContainText('It has no history entries.');
        await expect(modal.getByRole('checkbox')).toHaveCount(0);
        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).toHaveCount(0);
        expect(calls.filter(c => c.method === 'DeleteChatForUser')).toEqual([]);

        await deleteSelectedChatInUi(page, name);
        const deleted = calls.filter(c => c.method === 'DeleteChatForUser');
        expect(deleted.map(c => c.args[1])).toEqual([name]);
        expect(calls.filter(c => c.method === 'ClearHistory')).toEqual([]); // nothing to clear
        await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText('cockpit');
        await page.click('#ct-assistant-chat-toggle');
        await expect(chatOption(page, name)).toHaveCount(0);
        await page.keyboard.press('Escape');
    });

    test('New needs a name, refuses an existing one and offers to switch to it', async ({ page, browserName }) => {
        const calls = [];
        await openModule(page, observe(calls));
        const name = uniqueChatName(browserName);
        await createChatInUi(page, name);

        // A blank name creates nothing: Create waits for a name.
        await page.getByRole('button', { name: 'New', exact: true }).click();
        const modal = page.locator('.ct-assistant-new-chat-modal');
        const field = modal.locator('#ct-assistant-new-chat-name');
        const create = modal.getByRole('button', { name: 'Create' });
        await expect(field).toHaveAttribute('placeholder', 'e.g. firewall-questions');
        await expect(create).toBeDisabled();
        await field.fill('   ');
        await expect(create).toBeDisabled();
        await field.press('Enter');
        await expect(modal).toBeVisible();

        // Same name again: refused before CreateChat (clad would make a duplicate).
        await field.fill(name);
        await create.click();
        await expect(modal.locator('.ct-assistant-chat-exists')).toContainText(`A chat named ${name} already exists.`);
        expect(calls.filter(c => c.method === 'CreateChat')).toHaveLength(1);

        // The existing cockpit chat (the test VMs have one), and switching to it.
        await field.fill('cockpit');
        await create.click();
        await expect(modal.locator('.ct-assistant-chat-exists')).toContainText('A chat named cockpit already exists.');
        expect(calls.filter(c => c.method === 'IsChatAvailable' && c.args[1] === 'cockpit').pop().reply[0][0]).toBe(true);
        await modal.getByRole('button', { name: 'Switch to cockpit' }).click();
        await expect(modal).toHaveCount(0);
        await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText('cockpit');
        await expect(page.locator('.ct-assistant-saved-to')).toHaveText('Saved to chat: cockpit');
        expect(calls.filter(c => c.method === 'CreateChat')).toHaveLength(1);

        await selectChat(page, name);
        await deleteSelectedChatInUi(page, name);
    });
});
