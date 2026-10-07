// The PoC this module replaces had an XSS sink on the answer. Feed the real
// page a hostile "answer" and check none of it becomes live markup.
// AskQuestion/WriteHistory are answered locally by the test: nothing is sent
// to the backend and nothing hostile lands in the user's history.
const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');

const HOSTILE = [
    'Intro <img src=x onerror="window.__ctXss=1"> after',
    '',
    '<script>window.__ctXss=2</script>',
    '',
    '[click me](javascript:window.__ctXss=3) and [data](data:text/html,<b>x</b>)',
    '',
    '![pic](https://example.invalid/tracker.png)',
    '',
    '<a href="https://example.invalid" onclick="window.__ctXss=4">raw anchor</a>',
    '',
    '**Sources:**',
    '- [KB 12345](https://access.redhat.com/solutions/12345)',
].join('\n');

test('hostile markup in an answer is shown as text, never executed', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss() });

    await loginToCockpit(page);
    await routeCockpitSocket(page, {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method === 'AskQuestion')
                return { reply: [[{ message: { t: 's', v: HOSTILE } }]], id: body.id };
            if (method === 'WriteHistory')
                return { reply: [[]], id: body.id };
            return undefined;
        },
    });
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await expect(page.locator('.ct-assistant-status')).toContainText('Connected', { timeout: 30000 });

    await page.fill('#ct-assistant-question', 'security test');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const md = page.locator('.ct-assistant-answer .ct-markdown');
    await expect(md).toContainText('Sources:');

    // Raw HTML is literal text.
    await expect(md).toContainText('<img src=x onerror="window.__ctXss=1">');
    await expect(md).toContainText('<script>window.__ctXss=2</script>');
    await expect(md.locator('img, script, iframe, object, embed')).toHaveCount(0);
    await expect(md.locator('[onerror], [onclick]')).toHaveCount(0);

    // Unsafe link schemes lose the link but keep the text.
    await expect(md).toContainText('click me');
    await expect(md.locator('a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);

    // Images are not loaded; they become a plain link.
    await expect(md.locator('a[href="https://example.invalid/tracker.png"]')).toHaveText('pic');

    // Safe links open in a new tab without an opener.
    const kb = md.locator('a[href="https://access.redhat.com/solutions/12345"]');
    await expect(kb).toHaveText('KB 12345');
    await expect(kb).toHaveAttribute('target', '_blank');
    await expect(kb).toHaveAttribute('rel', 'noopener noreferrer');

    await md.getByText('click me').click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__ctXss)).toBeUndefined();
    expect(dialogs).toEqual([]);
});
