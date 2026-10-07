// Inline emphasis whose content starts with a code span (found in a real
// answer): its list item "**`cockpit-session` and …:** User …" showed
// literal ** instead of bold. The unit tests import lib/markdown.js directly;
// the rendered test feeds the same text to the real page as an answer
// (AskQuestion/WriteHistory answered locally, nothing reaches the backend).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openModule, localAsk } = require('./helpers/module.js');

// From a real answer (only the user name changed).
const ANSWER_ITEM = '**`cockpit-session` and `sudo /bin/cockpit-bridge --privileged`:** User `alice` is frequently opening sessions via `sudo`.';

const text = value => ({ type: 'text', value });
const code = value => ({ type: 'code', value });
const strong = (...children) => ({ type: 'strong', children });
const em = (...children) => ({ type: 'em', children });

async function markdownLib() {
    return import(path.join(__dirname, '..', 'src', 'lib', 'markdown.js'));
}

test.describe('markdown: emphasis around code spans (unit)', () => {
    test('the real-answer list item: strong holds both code spans', async () => {
        const { parseInline } = await markdownLib();
        expect(parseInline(ANSWER_ITEM)).toEqual([
            strong(code('cockpit-session'), text(' and '), code('sudo /bin/cockpit-bridge --privileged'), text(':')),
            text(' User '), code('alice'), text(' is frequently opening sessions via '), code('sudo'), text('.'),
        ]);
    });

    test('the real-answer list item inside a "*   " bullet', async () => {
        const { parseMarkdown } = await markdownLib();
        const blocks = parseMarkdown('*   ' + ANSWER_ITEM + '\n*   Second item.');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('list');
        expect(blocks[0].items).toHaveLength(2);
        const para = blocks[0].items[0][0];
        expect(para.type).toBe('paragraph');
        expect(para.children[0]).toEqual(
            strong(code('cockpit-session'), text(' and '), code('sudo /bin/cockpit-bridge --privileged'), text(':')));
        expect(JSON.stringify(blocks)).not.toContain('**');
    });

    test('strong / em whose content starts with a code span', async () => {
        const { parseInline } = await markdownLib();
        expect(parseInline('**`a`**')).toEqual([strong(code('a'))]);
        expect(parseInline('**x `a`:** y `b`')).toEqual([strong(text('x '), code('a'), text(':')), text(' y '), code('b')]);
        expect(parseInline('*`a` b*')).toEqual([em(code('a'), text(' b'))]);
        expect(parseInline('__`a`__')).toEqual([strong(code('a'))]);
    });

    test('no empty emphasis: delimiter runs with nothing inside stay literal', async () => {
        const { parseInline } = await markdownLib();
        expect(parseInline('****')).toEqual([text('****')]);
        expect(parseInline('** **')).toEqual([text('** **')]);
        expect(parseInline('a **** b')).toEqual([text('a **** b')]);
        expect(parseInline('____')).toEqual([text('____')]);
    });

    test('ordinary emphasis is unchanged', async () => {
        const { parseInline } = await markdownLib();
        expect(parseInline('**bold** and *em*')).toEqual([strong(text('bold')), text(' and '), em(text('em'))]);
        expect(parseInline('**a**b**c**')).toEqual([strong(text('a')), text('b'), strong(text('c'))]);
        expect(parseInline('*a*')).toEqual([em(text('a'))]);
        expect(parseInline('snake_case_name')).toEqual([text('snake_case_name')]);
        expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
        expect(parseInline('**Sources:**')).toEqual([strong(text('Sources:'))]);
    });
});

test('rendered: the real-answer list item shows bold with code inside, no literal **', async ({ page }) => {
    const answer = [
        'Sessions seen in the log:',
        '',
        '*   ' + ANSWER_ITEM,
        '*   **`a`** then *`b` c*',
    ].join('\n');
    const { route } = localAsk(() => answer);
    await openModule(page, route);

    await page.fill('#ct-assistant-question', 'markdown render test');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const md = page.locator('.ct-assistant-answer .ct-markdown');
    await expect(md).toContainText('Sessions seen in the log:');

    const items = md.locator('li');
    await expect(items).toHaveCount(2);
    const bold = items.nth(0).locator('strong');
    await expect(bold).toHaveCount(1);
    await expect(bold.locator('code')).toHaveText(['cockpit-session', 'sudo /bin/cockpit-bridge --privileged']);
    await expect(bold).toHaveText('cockpit-session and sudo /bin/cockpit-bridge --privileged:');
    await expect(items.nth(0)).toHaveText('cockpit-session and sudo /bin/cockpit-bridge --privileged: User alice is frequently opening sessions via sudo.');
    await expect(items.nth(1).locator('strong > code')).toHaveText('a');
    await expect(items.nth(1).locator('em > code')).toHaveText('b');
    await expect(md).not.toContainText('**');
    // Still only text and the renderer's own elements: no markup from the answer.
    await expect(md.locator('img, script, iframe, object, embed, [onerror], [onclick]')).toHaveCount(0);
});
