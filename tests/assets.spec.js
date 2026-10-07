// Fonts, icon fonts and images the bundled CSS points at. The build copies
// only the PatternFly assets index.css references (build.js
// copyReferencedAssets), so this checks that every one of them, and every
// Cockpit static font it uses, is really served, and that the fonts load.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, openAbout } = require('./helpers/module.js');

const s = v => ({ t: 's', v });
// One stored entry with a code block, answered locally (nothing read or
// written for real), so an expanded row shows body text and Red Hat Mono.
const HISTORY = [{
    'chat-name': s('cockpit'),
    'created-at': s('2026-10-07 10:00:00.000001'),
    question: s('How do I list SELinux contexts?'),
    response: s('Use **ls**:\n\n```\nls -Z /etc\n```'),
}];

const stubHistory = {
    answer: (_channel, body) => (callMethod(body) === 'GetHistory'
        ? { reply: [[{ histories: { t: 'aa{sv}', v: HISTORY } }]], id: body.id }
        : undefined),
};

// The module's own files and Cockpit's ../../static ones it references.
const watched = url => /\/(assistant|static)\//.test(new URL(url).pathname);

test.describe('assets', () => {
    test('everything the CSS references is served, and the fonts load', async ({ page }) => {
        const bad = [];
        page.on('requestfailed', req => {
            if (watched(req.url()))
                bad.push(`${req.url()}: ${req.failure()?.errorText}`);
        });
        page.on('response', res => {
            if (watched(res.url()) && res.status() >= 400)
                bad.push(`${res.url()}: HTTP ${res.status()}`);
        });

        await openModule(page, stubHistory);
        await openAbout(page);
        await page.keyboard.press('Escape');
        await page.getByRole('tab', { name: 'History' }).click();
        const row = page.locator('.ct-assistant-history-row').first();
        await row.locator('.pf-v6-c-table__toggle button').click();
        await expect(page.locator('.ct-assistant-history-entry pre').first()).toBeVisible();

        // Every url() in index.css other than data:, resolved against the
        // stylesheet the way the browser does, must fetch with 2xx — including
        // those no element on this page happens to use yet (the background
        // images only apply under PatternFly's glass/felt themes).
        const fetched = await page.evaluate(async () => {
            const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
                    .find(l => new URL(l.href).pathname.endsWith('/index.css'));
            const css = await (await fetch(link.href)).text();
            const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
                    .map(m => m[1])
                    .filter(u => !u.startsWith('data:'))
                    .map(u => new URL(u, link.href).href);
            return Promise.all([...new Set(urls)].map(async u => ({ url: u, status: (await fetch(u)).status })));
        });
        expect(fetched.map(f => new URL(f.url).pathname)).toEqual(expect.arrayContaining([
            expect.stringMatching(/\/cla\/assets\/pficon\/pf-v6-pficon\.woff2$/),
            expect.stringMatching(/\/cla\/assets\/fonts\/webfonts\/fa-solid-900\.woff2$/),
            expect.stringMatching(/\/cla\/assets\/fonts\/RedHatText\/RedHatTextVF\.woff2$/),
            expect.stringMatching(/\/cla\/assets\/images\/PF-Bkg-Generic-Light\.svg$/),
        ]));
        expect(fetched.filter(f => f.status < 200 || f.status >= 300)).toEqual([]);

        // The page's text is in Red Hat Text / Red Hat Mono, and those faces
        // actually loaded (not a fallback after a failed download).
        await page.evaluate(() => document.fonts.ready);
        const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
        expect(bodyFont).toMatch(/^"?Red Hat Text"?/);
        const preFont = await page.locator('.ct-assistant-history-entry pre').first()
                .evaluate(el => getComputedStyle(el).fontFamily);
        expect(preFont).toMatch(/^"?Red Hat Mono"?/);

        // No element here uses the icon fonts (icons are SVG), so ask for them:
        // load() fetches and decodes every matching face, and each must end up
        // "loaded" rather than "error".
        const faces = await page.evaluate(async () => {
            const out = {};
            for (const family of ['Red Hat Text', 'Red Hat Mono', 'pf-v6-pficon', 'Font Awesome 5 Free']) {
                try {
                    const loaded = await document.fonts.load(`900 16px "${family}"`);
                    out[family] = loaded.map(f => f.status);
                } catch (e) {
                    out[family] = [String(e)];
                }
            }
            for (const f of document.fonts)
                if (f.family.replace(/"/g, '') === 'Red Hat Text' && f.status === 'loaded')
                    out.textInUse = true;
            return out;
        });
        for (const family of ['Red Hat Text', 'Red Hat Mono', 'pf-v6-pficon', 'Font Awesome 5 Free']) {
            expect(faces[family].length, family).toBeGreaterThan(0);
            expect(faces[family].every(st => st === 'loaded'), `${family}: ${faces[family]}`).toBe(true);
        }
        expect(faces.textInUse).toBe(true);

        expect(bad).toEqual([]);
    });
});
