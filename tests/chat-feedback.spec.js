// Chat changes are visible where the user is working: a
// toast on create and delete, the target chat beside the question box, and a
// divider before exchanges that were saved to a different chat. CreateChat,
// IsChatAvailable, GetChatId and DeleteChatForUser are the real clad;
// AskQuestion/WriteHistory are answered locally (nothing reaches the backend
// or history).
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, createChatInUi, deleteSelectedChatInUi, uniqueChatName, localAsk } = require('./helpers/module.js');

const askButton = page => page.locator('.ct-assistant-actions button[type="submit"]');
const listItems = page => page.locator('.ct-assistant-exchanges > *');
const toasts = page => page.locator('.ct-assistant-toasts .pf-v6-c-alert');

async function ask(page, question) {
    const before = await page.locator('.ct-assistant-answer').count();
    await page.fill('#ct-assistant-question', question);
    await askButton(page).click();
    await expect(page.locator('.ct-assistant-answer')).toHaveCount(before + 1);
}

test('creating and deleting a chat is confirmed, and the Ask box names the target chat', async ({ page, browserName }) => {
    const backend = localAsk(message => `Reply to ${message}.`);
    const calls = [];
    await openModule(page, {
        ...backend.route,
        toServer: (_channel, body) => {
            const method = callMethod(body);
            if (method)
                calls.push({ method, args: body.call[3] });
            return undefined;
        },
    });
    const savedTo = page.locator('.ct-assistant-saved-to');
    await expect(savedTo).toHaveText('Saved to chat: cockpit');

    await ask(page, 'question in cockpit');
    await expect(page.locator('.ct-assistant-chat-divider')).toHaveCount(0);
    await expect(page.locator('.ct-assistant-history-note').first()).toHaveText('Saved to chat cockpit.');

    // Create: toast, the line by the question box changes, focus goes to the question.
    const name = uniqueChatName(browserName);
    await createChatInUi(page, name);
    expect(calls.filter(c => c.method === 'CreateChat').map(c => c.args[1])).toEqual([name]);
    await expect(toasts(page).filter({ hasText: `Created the chat named ${name}. New questions are saved to it.` }))
            .toBeVisible();
    await expect(page.locator('.ct-assistant-toasts')).toHaveAttribute('aria-live', 'polite');
    await expect(savedTo).toHaveText(`Saved to chat: ${name}`);
    await expect(page.locator('#ct-assistant-question')).toBeFocused();

    // The earlier exchange is marked as belonging to the other chat.
    await expect(listItems(page)).toHaveCount(2);
    await expect(listItems(page).nth(0)).toHaveClass(/ct-assistant-chat-divider/);
    await expect(listItems(page).nth(0)).toHaveText('Asked earlier on this page, saved to chat cockpit');
    await expect(listItems(page).nth(1)
            .locator('.ct-assistant-question-text')).toHaveText('question in cockpit');

    // Asking in the new chat puts the new exchange above that divider.
    await ask(page, 'question in the new chat');
    await expect(listItems(page)).toHaveCount(3);
    await expect(listItems(page).nth(0)
            .locator('.ct-assistant-question-text')).toHaveText('question in the new chat');
    await expect(listItems(page).nth(0)
            .locator('.ct-assistant-history-note')).toHaveText(`Saved to chat ${name}.`);
    await expect(listItems(page).nth(1)).toHaveText('Asked earlier on this page, saved to chat cockpit');
    expect(calls.filter(c => c.method === 'GetChatId').pop().args[1]).toBe(name);

    // The create toast goes away by itself.
    await expect(toasts(page).filter({ hasText: 'Created the chat named' })).toHaveCount(0, { timeout: 20000 });

    // Delete: toast says what happened and where questions go now.
    await deleteSelectedChatInUi(page, name);
    await expect(toasts(page).filter({ hasText: `Removed the chat named ${name}. Now using cockpit.` })).toBeVisible();
    await expect(savedTo).toHaveText('Saved to chat: cockpit');
    // Now the newest exchange is the other chat's.
    await expect(listItems(page)).toHaveCount(4);
    await expect(listItems(page).nth(0)).toHaveText(`Asked earlier on this page, saved to chat ${name}`);
    await expect(listItems(page).nth(2)).toHaveText('Asked earlier on this page, saved to chat cockpit');

    // A toast can be closed by hand.
    await toasts(page).first()
            .getByRole('button', { name: /^Close/ })
            .click();
    await expect(toasts(page)).toHaveCount(0);
});
