// Ask tab ordering and keyboard: the newest exchange is on top, right under
// the Ask box; Enter asks, Shift+Enter is a newline, and Enter does nothing
// while the Ask button is disabled. AskQuestion/WriteHistory are answered
// locally: nothing is sent to the backend or into history.
const { test, expect } = require('@playwright/test');
const { openModule, pasteContext } = require('./helpers/module.js');
const { callMethod } = require('./helpers/socket.js');

// A first answer long enough that anything appended below it would be off-screen.
const LONG_ANSWER = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of the first answer.`).join('\n\n');

// Answer AskQuestion/WriteHistory locally. `hold()` makes the next AskQuestion
// wait until the returned release function is called.
function localBackend(page, answerFor) {
    const asked = [];
    let held = null;
    const route = {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method === 'AskQuestion') {
                const message = body.call[3][1].message.v;
                asked.push(message);
                const reply = { reply: [[{ message: { t: 's', v: answerFor(message, asked.length) } }]], id: body.id };
                if (held) {
                    const wait = held;
                    held = null;
                    return wait.then(() => reply);
                }
                return reply;
            }
            if (method === 'WriteHistory')
                return { reply: [[]], id: body.id };
            return undefined;
        },
    };
    const hold = () => {
        let release;
        held = new Promise(resolve => { release = resolve });
        return release;
    };
    return { route, asked, hold };
}

// By type, not name: while a request is in flight the button's spinner changes its accessible name.
const askButton = page => page.locator('.ct-assistant-actions button[type="submit"]');
const exchanges = page => page.locator('.ct-assistant-exchanges > .ct-assistant-exchange');
const firstExchange = page => exchanges(page).first();

// Ask two questions, the first with LONG_ANSWER, and wait for both exchanges.
async function askTwo(page) {
    const backend = localBackend(page, (_message, n) => (n === 1 ? LONG_ANSWER : `Answer number ${n}.`));
    await openModule(page, backend.route);

    await page.fill('#ct-assistant-question', 'order test first');
    await askButton(page).click();
    await expect(exchanges(page)).toHaveCount(1);
    await expect(firstExchange(page).locator('.ct-assistant-answer')).toContainText('Paragraph 60 of the first answer.');

    await page.fill('#ct-assistant-question', 'order test second');
    await askButton(page).click();
    await expect(exchanges(page)).toHaveCount(2);
}

test.describe('Ask tab ordering and keyboard', () => {
    // 1280x800: tall enough that the second exchange shows more than the 200px
    // revealAnswer() asks for, so nothing scrolls. The 720px case is below.
    test('the newest exchange is first, right under the Ask box, visible without scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await askTwo(page);

        // Newest first, and each answer filled into its own exchange.
        const newest = exchanges(page).nth(0);
        const older = exchanges(page).nth(1);
        await expect(newest.locator('.ct-assistant-question-text')).toHaveText('order test second');
        await expect(newest.locator('.ct-assistant-answer .ct-markdown')).toHaveText('Answer number 2.');
        await expect(newest.locator('.ct-assistant-history-note')).toHaveText('Saved to chat cockpit.');
        await expect(older.locator('.ct-assistant-question-text')).toHaveText('order test first');
        await expect(older.locator('.ct-assistant-answer')).toContainText('Paragraph 1 of the first answer.');
        await expect(older.locator('.ct-assistant-answer')).not.toContainText('Answer number 2.');

        // The exchanges come straight after the Ask form card.
        expect(await page.locator('.ct-assistant-form-card + .ct-assistant-exchanges').count()).toBe(1);

        // Nothing on the page was scrolled, and the new answer is fully on screen.
        const scrolled = await page.evaluate(() => Array.from(document.querySelectorAll('*'))
                .filter(el => el.scrollTop > 0)
                .map(el => el.tagName + '.' + el.className));
        expect(scrolled).toEqual([]);
        // The question, the response heading and the answer text are all fully
        // visible (the card's history footer may run past the bottom of the window).
        await expect(newest.locator('.ct-assistant-question-text')).toBeInViewport({ ratio: 1 });
        await expect(newest.getByRole('heading', { name: 'Response from the command-line assistant' }))
                .toBeInViewport({ ratio: 1 });
        await expect(newest.locator('.ct-assistant-answer .ct-markdown')).toBeInViewport({ ratio: 1 });
        // The long older answer runs off the bottom of the screen.
        await expect(older.getByText('Paragraph 60 of the first answer.')).not.toBeInViewport();
    });

    // 1280x720: under the page header and the Ask form, less than 200px of the
    // second exchange would be on screen, so revealAnswer() scrolls it to the top.
    test('at 720px the answered exchange is scrolled to the top of the page and fully shown', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await askTwo(page);

        const newest = exchanges(page).nth(0);
        await expect(newest.locator('.ct-assistant-question-text')).toHaveText('order test second');
        await expect(newest.locator('.ct-assistant-answer .ct-markdown')).toHaveText('Answer number 2.');
        await expect(newest.locator('.ct-assistant-history-note')).toHaveText('Saved to chat cockpit.');

        // Only the page's main scroller moved.
        await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('*'))
                .filter(el => el.scrollTop > 0)
                .map(el => el.tagName + '.' + el.className))).toEqual(['MAIN.pf-v6-c-page__main']);

        const m = await newest.evaluate(el => {
            const main = document.querySelector('main.pf-v6-c-page__main');
            const r = el.getBoundingClientRect();
            const mr = main.getBoundingClientRect();
            return {
                scrollTop: main.scrollTop,
                mainTop: mr.top,
                top: r.top,
                bottom: r.bottom,
                height: r.height,
                scrollMargin: parseFloat(getComputedStyle(el).scrollMarginTop),
                innerHeight: window.innerHeight,
            };
        });
        // Unscrolled, the exchange would start at top + scrollTop, leaving
        // less than min(height, 200) px of it inside the window: why it scrolled.
        const unscrolledTop = m.top + m.scrollTop;
        expect(Math.min(m.bottom + m.scrollTop, m.innerHeight) - unscrolledTop).toBeLessThan(Math.min(m.height, 200));
        // scrollIntoView({ block: "start" }) put the exchange at the top of the
        // scroller, less its scroll-margin (the spacer-lg gap from app.scss), so
        // the scroll moved it by exactly its unscrolled offset minus that gap.
        expect(m.scrollMargin).toBeGreaterThan(0);
        expect(Math.abs(m.top - m.mainTop - m.scrollMargin)).toBeLessThanOrEqual(2);
        expect(Math.abs(m.scrollTop - (unscrolledTop - m.mainTop - m.scrollMargin))).toBeLessThanOrEqual(2);
        // The whole card, or a full window of it, is on screen.
        const visible = Math.min(m.bottom, m.innerHeight) - Math.max(m.top, 0);
        expect(visible).toBeGreaterThanOrEqual(Math.min(m.height, m.innerHeight - m.mainTop - m.scrollMargin) - 2);
        console.log(`720px reveal: ${JSON.stringify({ ...m, visible })}`);

        await expect(newest.locator('.ct-assistant-question-text')).toBeInViewport({ ratio: 1 });
        await expect(newest.getByRole('heading', { name: 'Response from the command-line assistant' }))
                .toBeInViewport({ ratio: 1 });
        await expect(newest.locator('.ct-assistant-answer .ct-markdown')).toBeInViewport({ ratio: 1 });
    });

    test('Enter asks; the question is sent as typed', async ({ page }) => {
        const backend = localBackend(page, () => 'Enter reply.');
        await openModule(page, backend.route);

        await page.click('#ct-assistant-question');
        await page.keyboard.type('enter test question');
        await page.keyboard.press('Enter');

        await expect(exchanges(page)).toHaveCount(1);
        await expect(firstExchange(page).locator('.ct-assistant-question-text')).toHaveText('enter test question');
        await expect(firstExchange(page).locator('.ct-assistant-answer')).toContainText('Enter reply.');
        expect(backend.asked).toEqual(['enter test question']);
        await expect(page.locator('#ct-assistant-question')).toHaveValue('');
    });

    test('Shift+Enter inserts a newline and does not ask', async ({ page }) => {
        const backend = localBackend(page, () => 'Multi-line reply.');
        await openModule(page, backend.route);

        await page.click('#ct-assistant-question');
        await page.keyboard.type('line one');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('line two');

        await expect(page.locator('#ct-assistant-question')).toHaveValue('line one\nline two');
        await expect(exchanges(page)).toHaveCount(0);
        expect(backend.asked).toEqual([]);

        // Then Enter sends both lines.
        await page.keyboard.press('Enter');
        await expect(exchanges(page)).toHaveCount(1);
        await expect(firstExchange(page).locator('.ct-assistant-answer')).toContainText('Multi-line reply.');
        expect(backend.asked).toEqual(['line one\nline two']);
    });

    test('Enter does nothing while Ask is disabled', async ({ page }) => {
        const backend = localBackend(page, () => 'Held reply.');
        await openModule(page, backend.route);
        const box = page.locator('#ct-assistant-question');

        // Empty question. Enter says why nothing happened.
        await expect(askButton(page)).toBeDisabled();
        await box.click();
        await expect(page.locator('.ct-assistant-blocked')).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(box).toHaveValue('');
        await expect(page.locator('.ct-assistant-blocked')).toHaveText('Type a question to ask.');

        // Whitespace only.
        await box.fill('   ');
        await expect(askButton(page)).toBeDisabled();
        await box.press('End');
        await page.keyboard.press('Enter');
        await expect(box).toHaveValue('   ');

        // Question over the 32,000-character limit.
        await box.fill('q'.repeat(32001));
        await expect(askButton(page)).toBeDisabled();
        await box.press('End');
        await page.keyboard.press('Enter');
        await expect(box).toHaveValue('q'.repeat(32001));

        expect(backend.asked).toEqual([]);
        await expect(exchanges(page)).toHaveCount(0);

        // A request in flight.
        const release = backend.hold();
        await box.fill('in flight one');
        await page.keyboard.press('Enter');
        await expect(exchanges(page)).toHaveCount(1);
        await expect(page.locator('.ct-assistant-pending')).toBeVisible();
        await expect(askButton(page)).toBeDisabled();
        // Pending feedback: "Asking…" beside Ask and a counting elapsed time.
        await expect(page.locator('.ct-assistant-ask-status')).toContainText('Asking…');
        await expect(page.locator('.ct-assistant-elapsed')).toHaveText(/^\d+ s$/);
        await expect(page.locator('.ct-assistant-elapsed')).not.toHaveText('0 s', { timeout: 5000 });
        await box.fill('in flight two');
        await page.keyboard.press('Enter');
        await expect(box).toHaveValue('in flight two');
        await expect(page.locator('.ct-assistant-blocked'))
                .toHaveText('Waiting for the current answer. Your question stays in the box until you ask it.');
        await expect(exchanges(page)).toHaveCount(1);
        expect(backend.asked).toEqual(['in flight one']);

        release();
        await expect(firstExchange(page).locator('.ct-assistant-answer')).toContainText('Held reply.');
        await expect(page.locator('.ct-assistant-pending')).toHaveCount(0);
        await expect(askButton(page)).toBeEnabled();
        await expect(page.locator('.ct-assistant-blocked')).toHaveCount(0);
        await expect(page.locator('.ct-assistant-ask-status')).toHaveCount(0);
    });

    test('Ask stays put when the context editor opens, and the new exchange is scrolled into view', async ({ page }) => {
        const backend = localBackend(page, () => 'Scrolled reply.');
        await openModule(page, backend.route);
        await page.setViewportSize({ width: 1280, height: 600 });

        // Opening the editor does not move the Ask button.
        const before = await askButton(page).boundingBox();
        await pasteContext(page, Array.from({ length: 40 }, (_, i) => `context line ${i}`).join('\n'));
        const after = await askButton(page).boundingBox();
        expect(Math.abs(after.y - before.y)).toBeLessThan(120); // only the attachment line above it
        await expect(page.locator('.ct-assistant-attachment')).toBeVisible();
        // With the editor open, the place the exchange will go is below the fold.
        const formBottom = await page.locator('.ct-assistant-form-card').evaluate(el => el.getBoundingClientRect().bottom);
        expect(formBottom).toBeGreaterThan(600);

        const release = backend.hold();
        await page.fill('#ct-assistant-question', 'scroll test');
        await askButton(page).click();
        await expect(page.locator('.ct-assistant-pending')).toBeInViewport();
        release();
        await expect(firstExchange(page).getByRole('heading', { name: 'Response from the command-line assistant' }))
                .toBeInViewport({ ratio: 1 });
        await expect(firstExchange(page).locator('.ct-assistant-answer .ct-markdown')).toHaveText('Scrolled reply.');
        await expect(firstExchange(page).locator('.ct-assistant-answer .ct-markdown')).toBeInViewport({ ratio: 1 });
    });
});
