// Which command-line-assistant build the test host runs, and what the page
// shows for that build (DESIGN.md "Supported command-line-assistant
// versions"). Specs assert the installed build's behaviour explicitly; none
// of them skip because of the build.
const { expect } = require('@playwright/test');
const { ssh } = require('./module.js');

// Dotted numeric VERSION of rpm's VERSION-RELEASE, compared with `than`.
function older(versionRelease, than) {
    const have = versionRelease.split('-')[0].split('.').map(Number);
    const need = than.split('.').map(Number);
    for (let i = 0; i < Math.max(have.length, need.length); i++) {
        if ((have[i] || 0) !== (need[i] || 0))
            return (have[i] || 0) < (need[i] || 0);
    }
    return false;
}

let cached = null;

// rpm's VERSION-RELEASE of command-line-assistant on the test host: over ssh
// when COCKPIT_SSH is set, otherwise from the page's About popover (rpm, read
// through the bridge). `page` must have the module open in that second case.
async function installedCladBuild(page) {
    if (cached)
        return cached;
    let build;
    if (process.env.COCKPIT_SSH) {
        build = ssh("rpm -q --queryformat '%{VERSION}-%{RELEASE}' command-line-assistant").trim();
    } else {
        await page.getByRole('button', { name: 'About', exact: true }).click();
        const line = page.locator('.ct-assistant-about .ct-assistant-version');
        await expect(line).toHaveText(/^command-line-assistant \d+\.\d+\.\d+-\S+$/);
        build = (await line.textContent()).replace('command-line-assistant ', '');
        await page.keyboard.press('Escape');
        await expect(page.locator('.ct-assistant-about')).toHaveCount(0);
    }
    expect(build, 'command-line-assistant must be installed on the test host').toMatch(/^\d+\.\d+\.\d+-\S+$/);
    cached = build;
    return build;
}

// What the page shows for a build, on a host using clad's default (Red Hat)
// endpoint, as the test hosts do:
// - supported: 0.4.2 and newer; older builds get the "Unsupported version" state.
// - endpointLine: the About line, only where clad has IsRedHatManagedEndpoint
//   (0.5.2 and newer); null where the line is left out.
// - redHatSentence: Red Hat's "may be used to improve…" sentences, which `c`
//   prints on every endpoint before 0.5.2 and on a Red Hat endpoint from 0.5.2.
function expectedFor(build) {
    const hasManagedMethod = !older(build, '0.5.2');
    return {
        build,
        supported: !older(build, '0.4.2'),
        hasManagedMethod,
        endpointLine: hasManagedMethod ? 'Red Hat managed endpoint' : null,
        redHatSentence: true,
    };
}

async function cladBuild(page) {
    return expectedFor(await installedCladBuild(page));
}

// The About popover's endpoint line for this build: the text, or absent.
async function expectEndpointLine(about, expected) {
    const line = about.locator('.ct-assistant-endpoint');
    if (expected.endpointLine)
        await expect(line).toHaveText(expected.endpointLine);
    else
        await expect(line).toHaveCount(0);
}

module.exports = { cladBuild, expectedFor, expectEndpointLine, older };
