// Accessibility: a page heading, a polite live region that
// announces the question being sent and the answer arriving, aria-busy on the
// pending exchange, and the Copy tooltip. AskQuestion/WriteHistory are
// answered locally. The page header: the connection details behind "Connected"
// open from the keyboard, not on hover only.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule } = require('./helpers/module.js');
const { loginToCockpit } = require('./helpers/cockpit.js');

// The first AskQuestion waits for release(); the second fails with a D-Bus error.
function heldBackend() {
    let release;
    const held = new Promise(resolve => { release = resolve });
    let n = 0;
    const route = {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method === 'AskQuestion') {
                n++;
                if (n === 1)
                    return held.then(() => ({ reply: [[{ message: { t: 's', v: 'Held **answer**.' } }]], id: body.id }));
                return { error: ['org.freedesktop.DBus.Error.Failed', ['Backend said no.']], id: body.id };
            }
            if (method === 'WriteHistory')
                return { reply: [[]], id: body.id };
            return undefined;
        },
    };
    return { route, release: () => release() };
}

test('heading, live announcements and aria-busy', async ({ page }) => {
    const backend = heldBackend();
    await openModule(page, backend.route);

    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toHaveCount(1);

    const status = page.locator('.ct-assistant-announcer');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveText('');

    await page.fill('#ct-assistant-question', 'a11y question');
    await page.keyboard.press('Enter');
    const exchange = page.locator('.ct-assistant-exchange').first();
    await expect(exchange).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveText('Asking the command-line assistant…');

    backend.release();
    await expect(exchange.locator('.ct-assistant-answer')).toBeVisible();
    await expect(exchange).toHaveAttribute('aria-busy', 'false');
    await expect(status).toHaveText('Answer received from the command-line assistant.');

    // Copy says what it copies.
    await exchange.getByRole('button', { name: 'Copy', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Copy as Markdown');

    // An error is announced too.
    await page.fill('#ct-assistant-question', 'a11y question that fails');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ct-assistant-exchange').first()
            .locator('.ct-assistant-ask-error')).toContainText('Backend said no.');
    await expect(status).toHaveText('The command-line assistant returned an error.');
});

test('About: reachable by keyboard, named for screen readers', async ({ page }) => {
    await loginToCockpit(page);
    await expect(page.locator('.ct-assistant-status')).toContainText('Connected', { timeout: 30000 });
    const button = page.getByRole('button', { name: 'About' });
    await expect(button).toHaveCount(1);

    // Hovering alone shows nothing: the facts are not in a hover-only tooltip.
    await button.hover();
    await page.waitForTimeout(500);
    await expect(page.locator('.ct-assistant-about')).toHaveCount(0);
    await page.mouse.move(0, 0);

    // Tab to it from the top of the page.
    await page.locator('body').focus();
    let reached = false;
    for (let n = 0; n < 15 && !reached; n++) {
        await page.keyboard.press('Tab');
        reached = await button.evaluate(el => el === document.activeElement);
    }
    expect(reached).toBe(true);

    await page.keyboard.press('Enter');
    const details = page.getByRole('dialog', { name: 'About' });
    await expect(details).toBeVisible();
    await expect(details).toContainText(/Red Hat endpoint|Custom endpoint/);
    await expect(details).toContainText(/command-line-assistant \d+\.\d+\.\d+-\S+/);
    // Its two feedback sections are headed at the same level, and nothing else is a heading.
    await expect(details.getByRole('heading')).toHaveCount(2);
    await expect(details.getByRole('heading', { level: 2 }))
            .toHaveText(['Feedback on the command-line assistant', 'Feedback on this page']);

    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

    // Space opens it too.
    await button.focus();
    await page.keyboard.press(' ');
    await expect(details).toBeVisible();
});
