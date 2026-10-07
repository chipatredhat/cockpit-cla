// The 32,000-character limit on question + context: the context is trimmed,
// never the question, and every message says which end of the context is kept.
const { test, expect } = require('@playwright/test');
const { openModule, pasteContext, localAsk } = require('./helpers/module.js');

const QUESTION = 'What is in this log?'; // 20 characters
// 40,000 characters whose two ends differ, so the test can tell which was sent.
const LONG_CONTEXT = 'H'.repeat(20000) + 'T'.repeat(20000);

const askButton = page => page.locator('.ct-assistant-actions button[type="submit"]');

test.describe('32,000-character limit', () => {
    test.describe('counter and notices', () => {
        test.beforeEach(async ({ page }) => {
            await openModule(page);
        });

        test('the counter appears with context and counts context + question', async ({ page }) => {
            const counter = page.locator('.ct-assistant-counter');
            await expect(counter).toHaveCount(0);
            await page.fill('#ct-assistant-question', 'hello');
            await expect(counter).toHaveCount(0);
            await pasteContext(page, 'abc');
            await expect(counter).toHaveText('3 context + 5 question / 32,000 characters');
            await expect(page.locator('.ct-assistant-attachment')).toContainText('Context attached (pasted text): all 3 characters will be sent.');
            await expect(page.locator('.ct-assistant-keep')).toHaveCount(0); // nothing to trim, no choice
            await expect(page.locator('.ct-assistant-trim-notice')).toHaveCount(0);
        });

        test('over the limit: pasted context keeps its start by default, the user can pick the end', async ({ page }) => {
            await page.fill('#ct-assistant-question', QUESTION);
            await pasteContext(page, LONG_CONTEXT);

            const attachment = page.locator('.ct-assistant-attachment');
            await expect(attachment).toContainText('Context attached (pasted text): the first 31,980 of 40,000 characters will be sent.');
            await expect(page.locator('.ct-assistant-counter')).toHaveText('31,980 context + 20 question / 32,000 characters');
            // Expected, handled: no warning alert, and Ask stays available.
            await expect(page.locator('.ct-assistant-trim-notice')).toHaveCount(0);
            await expect(askButton(page)).toBeEnabled();

            await expect(page.getByRole('radio', { name: 'The first 31,980 characters' })).toBeChecked();
            await page.getByRole('radio', { name: 'The last 31,980 characters' }).check();
            await expect(attachment).toContainText('the last 31,980 of 40,000 characters will be sent.');
        });

        test('a question alone over the limit blocks Ask instead of being trimmed', async ({ page }) => {
            await page.fill('#ct-assistant-question', 'q'.repeat(32001));
            const notice = page.locator('.ct-assistant-trim-notice');
            await expect(notice).toHaveClass(/pf-m-danger/);
            await expect(notice).toContainText('The question alone is 32,001 characters, over the 32,000-character limit');
            await expect(askButton(page)).toBeDisabled();
        });
    });

    test('what is sent is the full question plus the chosen end of the context', async ({ page }) => {
        // AskQuestion and WriteHistory are answered locally by the test, so
        // no 40k-character junk goes to the real backend or into history.
        // Everything else (GetUserId, chat lookup) is the real daemon.
        const backend = localAsk(() => 'Local test reply.');
        await openModule(page, backend.route);

        await page.fill('#ct-assistant-question', QUESTION);
        await pasteContext(page, LONG_CONTEXT);
        await askButton(page).click();

        await expect(page.locator('.ct-assistant-answer')).toContainText('Local test reply.');
        const first = backend.asked[0];
        expect(first.message.v).toBe(QUESTION);
        expect(first.attachment.v.contents.v).toBe(LONG_CONTEXT.slice(0, 31980));
        expect(first.message.v.length + first.attachment.v.contents.v.length).toBe(32000);
        await expect(page.locator('.ct-assistant-context-note').first())
                .toHaveText('Context: pasted text, the first 31,980 of 40,000 characters sent (trimmed to fit the 32,000-character limit).');

        // The other end, on the user's choice.
        // (The room left depends on the question, so type it first.)
        await page.fill('#ct-assistant-question', QUESTION);
        await page.getByRole('radio', { name: 'The last 31,980 characters' }).check();
        await askButton(page).click();
        await expect(page.locator('.ct-assistant-answer')).toHaveCount(2);
        const second = backend.asked[1];
        expect(second.message.v).toBe(QUESTION);
        expect(second.attachment.v.contents.v).toBe(LONG_CONTEXT.slice(-31980));
        await expect(page.locator('.ct-assistant-context-note').first())
                .toHaveText('Context: pasted text, the last 31,980 of 40,000 characters sent (trimmed to fit the 32,000-character limit).');
    });
});
