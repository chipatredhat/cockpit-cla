// What context goes with a question is always on screen,
// and a trimmed file keeps its end unless the user picks its start.
// AskQuestion/WriteHistory are answered locally: nothing reaches the backend
// or history; the file reads are the real cockpit-bridge.
const { test, expect } = require('@playwright/test');
const { openModule, pasteContext, readFileInUi, localAsk, ssh } = require('./helpers/module.js');

const askButton = page => page.locator('.ct-assistant-actions button[type="submit"]');
const attachment = page => page.locator('.ct-assistant-attachment');
const contextToggle = page => page.getByRole('button', { name: /^Add context/ });

// Ask, checking first that whatever context will go is shown above the button.
async function askSeeingContext(page, question, expectContext) {
    await page.fill('#ct-assistant-question', question);
    if (expectContext) {
        await expect(attachment(page)).toBeVisible();
        await expect(attachment(page)).toBeInViewport();
    } else {
        await expect(attachment(page)).toHaveCount(0);
    }
    const before = await page.locator('.ct-assistant-exchange').count();
    await askButton(page).click();
    await expect(page.locator('.ct-assistant-answer')).toHaveCount(before + 1);
}

test('context stays attached only while it is shown; Remove clears it', async ({ page }) => {
    const backend = localAsk();
    await openModule(page, backend.route);

    await pasteContext(page, 'CONTEXT-ONE');
    await contextToggle(page).click(); // collapse the editor: the line stays
    await expect(contextToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(attachment(page)).toContainText('Context attached (pasted text): all 11 characters will be sent.');

    await askSeeingContext(page, 'first question', true);
    expect(backend.asked[0].attachment.v.contents.v).toBe('CONTEXT-ONE');
    // After asking, the question box is empty but the context is still
    // attached — and still shown, so a follow-up sends it knowingly.
    await expect(page.locator('#ct-assistant-question')).toHaveValue('');
    await expect(attachment(page)).toContainText('all 11 characters will be sent.');

    await askSeeingContext(page, 'follow-up question', true);
    expect(backend.asked[1].attachment.v.contents.v).toBe('CONTEXT-ONE');
    await expect(page.locator('.ct-assistant-context-note').first()).toHaveText('Context: pasted text, 11 characters sent.');

    // Remove: the line goes, and the next question carries no context.
    await attachment(page).getByRole('button', { name: 'Remove' })
            .click();
    await expect(attachment(page)).toHaveCount(0);
    await expect(page.locator('#ct-assistant-context-text')).toHaveValue('');
    await askSeeingContext(page, 'unrelated question', false);
    expect(backend.asked[2].attachment.v.contents.v).toBe('');
    await expect(page.locator('.ct-assistant-exchange').first()
            .locator('.ct-assistant-context-note')).toHaveCount(0);

    // Never sent without the line: three asks, two with context, both shown.
    expect(backend.asked.map(q => q.attachment.v.contents.v !== '')).toEqual([true, true, false]);

    // "Change" opens the editor on the attached text.
    await pasteContext(page, 'CONTEXT-TWO');
    await contextToggle(page).click();
    await attachment(page).getByRole('button', { name: 'Change' })
            .click();
    await expect(contextToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ct-assistant-context-text')).toBeFocused();
    await expect(page.locator('#ct-assistant-context-text')).toHaveValue('CONTEXT-TWO');
});

test('a file read keeps the end of the file by default; the start on request', async ({ page }) => {
    // /etc/services: world-readable, plain ASCII and far over 32,000 characters
    // on RHEL 9 and 10.
    const FILE = '/etc/services';
    const QUESTION = 'What is at the end?'; // 19 characters
    const ROOM = 32000 - QUESTION.length;
    const backend = localAsk();
    await openModule(page, backend.route);

    await readFileInUi(page, FILE);
    await expect(attachment(page)).toContainText(`Context attached from ${FILE}:`);
    const content = await page.locator('#ct-assistant-context-text').inputValue();
    // Counted in code points, as the module (and upstream c) counts.
    const chars = Array.from(content);
    expect(chars.length).toBeGreaterThan(32000);
    const total = chars.length.toLocaleString('en-US');

    await page.fill('#ct-assistant-question', QUESTION);
    const room = ROOM.toLocaleString('en-US');
    await expect(attachment(page)).toContainText(`Context attached from ${FILE}: the last ${room} of ${total} characters will be sent.`);
    await expect(page.getByRole('radio', { name: `The last ${room} characters` })).toBeChecked();

    // The context box shows the end that is sent.
    await contextToggle(page).click();
    const atEnd = await page.locator('#ct-assistant-context-text')
            .evaluate(el => el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    expect(atEnd).toBe(true);
    await contextToggle(page).click();

    await askButton(page).click();
    await expect(page.locator('.ct-assistant-answer')).toHaveCount(1);
    const tail = backend.asked[0].attachment.v.contents.v;
    expect(tail).toBe(chars.slice(-ROOM).join(''));
    expect(backend.asked[0].message.v).toBe(QUESTION);
    await expect(page.locator('.ct-assistant-context-note').first())
            .toHaveText(`Context: ${FILE}, the last ${room} of ${total} characters sent (trimmed to fit the 32,000-character limit).`);
    if (process.env.COCKPIT_SSH) {
        // The host's own idea of the file's end.
        const hostTail = ssh(`tail -n 5 ${FILE}`);
        expect(hostTail.length).toBeGreaterThan(0);
        expect(tail.endsWith(hostTail)).toBe(true);
    } else {
        test.info().annotations.push({ type: 'note', description: 'COCKPIT_SSH unset: tail -c cross-check not run' });
    }

    // The user can send the start instead, and every message says so.
    await page.fill('#ct-assistant-question', QUESTION); // the room depends on the question
    await page.getByRole('radio', { name: `The first ${room} characters` }).check();
    await expect(attachment(page)).toContainText(`the first ${room} of ${total} characters will be sent.`);
    await askButton(page).click();
    await expect(page.locator('.ct-assistant-answer')).toHaveCount(2);
    expect(backend.asked[1].attachment.v.contents.v).toBe(chars.slice(0, ROOM).join(''));
    await expect(page.locator('.ct-assistant-context-note').first())
            .toHaveText(`Context: ${FILE}, the first ${room} of ${total} characters sent (trimmed to fit the 32,000-character limit).`);
});
