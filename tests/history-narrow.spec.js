// History at phone width: every row's values are on screen,
// and a stored answer with a very long line of code scrolls inside its own
// block instead of widening the table. GetHistory is answered locally.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule } = require('./helpers/module.js');

const s = v => ({ t: 's', v });
const entry = (chat, at, question, response) =>
    ({ 'chat-name': s(chat), 'created-at': s(at), question: s(question), response: s(response) });

const LONG_LINE = 'journalctl ' + Array.from({ length: 80 }, (_, i) => `--unit=service-number-${i}`).join(' ');
const HISTORY = [
    entry('cockpit', '2026-10-06 13:00:00.000001', 'Show me a very long command', 'Here:\n\n```\n' + LONG_LINE + '\n```\n'),
    entry('default', '2026-10-06 12:00:00.000001', 'Show disk usage', 'Run `df -h`.'),
    entry('rhce testing', '2026-10-06 11:00:00.000001', 'What is firewalld?', 'A **dynamic** firewall daemon.'),
];

function stub() {
    return {
        answer: (_channel, body) => (callMethod(body) === 'GetHistory'
            ? { reply: [[{ histories: { t: 'aa{sv}', v: HISTORY } }]], id: body.id }
            : undefined),
    };
}

const rows = page => page.locator('.ct-assistant-history-row');

async function expectInside(locator, width) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
}

async function noHorizontalScroll(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('html, body, .pf-v6-c-page__main-container, .pf-v6-c-page__main'))
            .every(el => el.scrollWidth <= el.clientWidth + 1));
}

test('phone width: History values are on screen and wide code scrolls in its own box', async ({ page }) => {
    const WIDTH = 390;
    // Narrow only after login: the shell hides its admin button at phone width.
    await openModule(page, stub());
    await page.setViewportSize({ width: WIDTH, height: 844 });
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(rows(page)).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
        const row = rows(page).nth(i);
        await row.scrollIntoViewIfNeeded();
        for (const cls of ['.ct-assistant-history-time', '.ct-assistant-history-question', '.ct-assistant-history-chat'])
            await expectInside(row.locator(cls), WIDTH);
    }
    await expect(rows(page).nth(0)
            .locator('.ct-assistant-history-time')).toHaveText('2026-10-06 13:00:00.000001');
    await expect(rows(page).nth(2)
            .locator('.ct-assistant-history-chat')).toHaveText('rhce testing');
    expect(await noHorizontalScroll(page)).toBe(true);

    // Expanded: the code block is inside the screen and scrolls sideways itself.
    await rows(page).nth(0)
            .locator('.pf-v6-c-table__toggle button')
            .click();
    const pre = page.locator('.ct-assistant-history-entry .ct-md-pre').first();
    await expect(pre).toBeVisible();
    await pre.scrollIntoViewIfNeeded();
    await expectInside(pre, WIDTH);
    expect(await pre.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expectInside(page.locator('.ct-assistant-history-entry .ct-assistant-answer').first(), WIDTH);
    expect(await noHorizontalScroll(page)).toBe(true);
});

test('desktop width: a very long line of code does not widen the History table', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModule(page, stub());
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(rows(page)).toHaveCount(3);

    const fits = () => page.locator('.ct-assistant-history-table').evaluate(t => t.scrollWidth <= t.parentElement.clientWidth + 1);
    expect(await fits()).toBe(true);
    await rows(page).nth(0)
            .locator('.pf-v6-c-table__toggle button')
            .click();
    await expect(page.locator('.ct-assistant-history-entry .ct-md-pre').first()).toBeVisible();
    expect(await fits()).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
});
