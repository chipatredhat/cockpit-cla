// Rewrite Cockpit protocol frames between the module page and cockpit-ws.
//
// Used to put the real bridge/daemon into states that can't be produced on a
// healthy test VM without uninstalling packages (e.g. "not installed"): the
// rewrite changes what the page *asks for*, and the reply still comes from the
// real cockpit-bridge / clad. Install it AFTER loginToCockpit() and before
// navigating to the module, so only the module page's own socket is proxied
// (the specs only ever use it that way; proxying during login is untested).
//
// Frame format: "<channel>\n<json>"; control messages have an empty channel.

function parseFrame(message) {
    const text = String(message);
    const nl = text.indexOf('\n');
    if (nl < 0)
        return null;
    try {
        return { channel: text.slice(0, nl), body: JSON.parse(text.slice(nl + 1)) };
    } catch (e) {
        return null; // not JSON (e.g. binary payload) — pass through untouched
    }
}

function formatFrame(channel, body) {
    return channel + '\n' + JSON.stringify(body);
}

// toServer(channel, body) / toClient(channel, body): return a body to send
// (modified or not), or undefined to pass the original through.
// answer(channel, body): return a reply body to hand straight back to the page
// without forwarding the frame to the server at all (used to feed the
// renderer a hostile answer without sending anything to the real backend).
// It may also return a Promise of the reply, to hold a call in flight.
async function routeCockpitSocket(page, { toServer, toClient, answer } = {}) {
    await page.routeWebSocket(/\/cockpit\/socket/, ws => {
        const server = ws.connectToServer();
        ws.onMessage(message => {
            const frame = (toServer || answer) && parseFrame(message);
            const reply = frame && answer && answer(frame.channel, frame.body);
            if (reply) {
                Promise.resolve(reply).then(r => ws.send(formatFrame(frame.channel, r)));
                return;
            }
            const body = frame && toServer && toServer(frame.channel, frame.body);
            server.send(body ? formatFrame(frame.channel, body) : message);
        });
        server.onMessage(message => {
            const frame = toClient && parseFrame(message);
            const body = frame && toClient(frame.channel, frame.body);
            ws.send(body ? formatFrame(frame.channel, body) : message);
        });
    });
}

// The method name of a dbus-json3 call frame, if it is one.
function callMethod(body) {
    return Array.isArray(body?.call) ? body.call[2] : undefined;
}

module.exports = { routeCockpitSocket, callMethod };
