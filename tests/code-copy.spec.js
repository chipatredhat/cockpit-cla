// Copy button on fenced code blocks: in Ask answers and in
// History's expanded answers, copying exactly the block's code. Answers and
// history are answered locally (helpers/socket.js): nothing reaches the
// backend and nothing is written to history.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, localAsk } = require('./helpers/module.js');

const ANSWER = [
    'Here is `inline code` in a sentence.',
    '',
    '```bash',
    'sudo dnf install -y httpd',
    '  echo "two-space indent"',
    '\ttab-indented line',
    '```',
    '',
    'A block without a language:',
    '',
    '```',
    'line one',
    '    line two (four spaces)',
    '',
    'line four, trailing spaces   ',
    '```',
    '',
    '~~~',
    'a tilde fence with ``` inside',
    '~~~',
].join('\n');

// What each block holds: no fence, no language tag, whitespace as written.
const BLOCKS = [
    'sudo dnf install -y httpd\n  echo "two-space indent"\n\ttab-indented line',
    'line one\n    line two (four spaces)\n\nline four, trailing spaces   ',
    'a tilde fence with ``` inside',
];

const CLIPBOARD_ERROR = 'The browser does not allow clipboard access on this page.';

// Record every navigator.clipboard.writeText() argument, then let the real
// call go ahead.
async function recordClipboard(page) {
    await page.addInitScript(() => {
        window.__ctCopied = [];
        if (!navigator.clipboard)
            return;
        const real = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = text => {
            window.__ctCopied.push(text);
            return real(text);
        };
    });
}

const copiedTexts = page => page.evaluate(() => window.__ctCopied);

async function askLocally(page, answer) {
    const { route } = localAsk(() => answer);
    await openModule(page, route);
    await page.fill('#ct-assistant-question', 'code copy test');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const card = page.locator('.ct-assistant-answer');
    await expect(card.locator('.ct-markdown')).toContainText('Here is');
    return card;
}

test.describe('copy button on fenced code blocks', () => {
    test('Ask: each fenced block copies its code exactly; inline code has no button', async ({ page, browserName }) => {
        if (browserName === 'chromium')
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await recordClipboard(page);
        const card = await askLocally(page, ANSWER);
        const md = card.locator('.ct-markdown');

        // One button per fenced block, inside the block; none on inline code.
        const buttons = md.getByRole('button', { name: 'Copy code', exact: true });
        await expect(md.locator('pre')).toHaveCount(3);
        await expect(buttons).toHaveCount(3);
        await expect(md.locator('.ct-md-codeblock')).toHaveCount(3);
        await expect(md.locator('.ct-md-codeblock .ct-md-copy-code')).toHaveCount(3);
        await expect(md.locator('code.ct-md-code')).toHaveText(['inline code']);
        await expect(md.locator('p button, li button, code button, pre button')).toHaveCount(0);
        // Copy only: nothing in the answer offers to run anything.
        await expect(card.getByRole('button', { name: /run|execute/i })).toHaveCount(0);

        for (let i = 0; i < BLOCKS.length; i++) {
            // What is shown is what is copied.
            await expect(md.locator('pre').nth(i)).toHaveJSProperty('textContent', BLOCKS[i]);
            await buttons.nth(i).click();
            // Same feedback as the answer's Copy: a check and "Copied", announced.
            await expect(buttons.nth(i)).toHaveText('Copied');
            await expect(md.locator('.ct-md-codeblock').nth(i)
                    .locator('[aria-live="polite"]')).toHaveText('Copied');
            const copied = await copiedTexts(page);
            expect(copied[copied.length - 1]).toBe(BLOCKS[i]);
            if (browserName === 'chromium')
                expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(BLOCKS[i]);
        }
        expect(await copiedTexts(page)).toEqual(BLOCKS);
        await expect(md.locator('.ct-md-copy-error')).toHaveCount(0);

        // The whole-answer Copy is unchanged: the full answer, markdown and all.
        await card.getByRole('button', { name: 'Copy', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
        const copied = await copiedTexts(page);
        expect(copied[copied.length - 1]).toBe(ANSWER);
    });

    test('clipboard unavailable: the same error as the answer\'s Copy', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
        });
        const card = await askLocally(page, ANSWER);
        const block = card.locator('.ct-md-codeblock').first();
        await block.getByRole('button', { name: 'Copy code', exact: true }).click();
        await expect(block.locator('.ct-md-copy-error')).toHaveText(CLIPBOARD_ERROR);
        await expect(block.getByRole('button', { name: 'Copy code', exact: true })).not.toContainText('Copied');
        // Only the block that was clicked says so.
        await expect(card.locator('.ct-md-copy-error')).toHaveCount(1);
        // The answer's own Copy reports the same text.
        await card.getByRole('button', { name: 'Copy', exact: true }).click();
        await expect(card.locator('.ct-assistant-copy-error')).toHaveText(CLIPBOARD_ERROR);
    });

    test('History: expanded answers have the same copy buttons', async ({ page, browserName }) => {
        if (browserName === 'chromium')
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await recordClipboard(page);
        const s = v => ({ t: 's', v });
        const histories = [{
            'chat-name': s('cockpit'),
            'created-at': s('2026-10-07 09:00:00.000001'),
            question: s('code copy history test'),
            response: s(ANSWER),
        }];
        await openModule(page, {
            answer: (_channel, body) => (callMethod(body) === 'GetHistory'
                ? { reply: [[{ histories: { t: 'aa{sv}', v: histories } }]], id: body.id }
                : undefined),
        });
        await page.getByRole('tab', { name: 'History' }).click();
        const row = page.locator('.ct-assistant-history-row').filter({ hasText: 'code copy history test' });
        await row.locator('.pf-v6-c-table__toggle button').click();
        const md = page.locator('.ct-assistant-history-entry .ct-markdown');
        const buttons = md.getByRole('button', { name: 'Copy code', exact: true });
        await expect(buttons).toHaveCount(3);
        await expect(md.locator('p button, li button, code button, pre button')).toHaveCount(0);
        await buttons.nth(1).click();
        await expect(buttons.nth(1)).toHaveText('Copied');
        expect(await copiedTexts(page)).toEqual([BLOCKS[1]]);
    });
});
