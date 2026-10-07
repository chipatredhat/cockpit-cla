// SPDX-License-Identifier: LGPL-2.1-or-later
// clad (command-line assistant daemon) over the system bus — see DESIGN.md
// "Backend: the clad D-Bus API (verified live)".
//
// Never pass `superuser` here: clad authorizes by the caller's uid, so
// superuser would act on root's identity and root's history.
import cockpit from 'cockpit';

const _ = cockpit.gettext;

const USER = {
    name: "com.redhat.lightspeed.user",
    path: "/com/redhat/lightspeed/user",
    iface: "com.redhat.lightspeed.user",
};
const CHAT = {
    name: "com.redhat.lightspeed.chat",
    path: "/com/redhat/lightspeed/chat",
    iface: "com.redhat.lightspeed.chat",
};
const HISTORY = {
    name: "com.redhat.lightspeed.history",
    path: "/com/redhat/lightspeed/history",
    iface: "com.redhat.lightspeed.history",
};

// The web console's own chat. Never write into "default" — that is the CLI's.
export const WEB_CHAT_NAME = "cockpit";
export const CLI_CHAT_NAME = "default";
const WEB_CHAT_DESCRIPTION = "Asked from the web console";

// clad's GetAllChatFromUser returns at most this many chats, oldest first
// (`.limit(10)` in the chat repository, 0.5.2).
export const CHAT_LIST_LIMIT = 10;

// AskQuestion took 1.4–5.5 s in testing; leave plenty of headroom.
const ASK_TIMEOUT_MS = 120 * 1000;
const CALL_TIMEOUT_MS = 30 * 1000;

const clients = {};

function client(service) {
    if (!clients[service.name])
        clients[service.name] = cockpit.dbus(service.name, { bus: "system" });
    return clients[service.name];
}

function call(service, method, signature, args, timeout = CALL_TIMEOUT_MS) {
    return client(service).call(service.path, service.iface, method, args, { type: signature, timeout });
}

// Sort a D-Bus failure into the edge states in DESIGN.md's status table.
// cockpit.dbus rejects with { problem, name, message }: `name` for a D-Bus
// error reply, `problem` when the channel itself closed.
export function classifyError(ex) {
    const name = ex?.name || "";
    const problem = ex?.problem || "";
    if (name === "org.freedesktop.DBus.Error.AccessDenied" || problem === "access-denied")
        return "disabled";
    if (name === "org.freedesktop.DBus.Error.ServiceUnknown" || problem === "not-found")
        return "not-installed";
    return "error";
}

export async function getUserId(uid) {
    const [userId] = await call(USER, "GetUserId", "i", [uid]);
    return userId;
}

export async function isRedHatManagedEndpoint() {
    const [managed] = await call(CHAT, "IsRedHatManagedEndpoint", "", []);
    return managed;
}

// cockpit.dbus hands back variants as { t, v }.
const unwrap = x => (x && typeof x === "object" && "t" in x && "v" in x ? x.v : x);

function hasErrorName(ex, suffix) {
    return typeof ex?.name === "string" && ex.name.endsWith(suffix);
}

// [{ id, name, description, createdAt }], in the order clad returns them.
export async function getChats(userId) {
    const [reply] = await call(CHAT, "GetAllChatFromUser", "s", [userId]);
    return (unwrap(reply?.chats) || []).map(c => ({
        id: unwrap(c.id),
        name: unwrap(c.name),
        description: unwrap(c.description),
        createdAt: unwrap(c["created-at"]),
    }));
}

export async function isChatAvailable(userId, name) {
    const [available] = await call(CHAT, "IsChatAvailable", "ss", [userId, name]);
    return available;
}

// clad does not refuse a duplicate name (CreateChat is a plain insert), so
// callers check isChatAvailable first.
export async function createChat(userId, name) {
    const [chatId] = await call(CHAT, "CreateChat", "sss", [userId, name, WEB_CHAT_DESCRIPTION]);
    return chatId;
}

// Deletes the chat only. clad keeps the chat's history entries: GetHistory
// still returns them under the chat's name (verified on 0.5.2).
export async function deleteChat(userId, name) {
    await call(CHAT, "DeleteChatForUser", "ss", [userId, name]);
}

// Resolve the chat to write into, as upstream commands/chat.py
// _create_chat_session does. Only the web console's own chat is ever created
// here; any other name must already exist (never auto-create "default").
export async function ensureChat(userId, name) {
    if (await isChatAvailable(userId, name)) {
        const [chatId] = await call(CHAT, "GetChatId", "ss", [userId, name]);
        return chatId;
    }
    if (name !== WEB_CHAT_NAME)
        throw new Error(cockpit.format(_("There is no chat named $0. It may have been deleted elsewhere."), name));
    return createChat(userId, name);
}

// All five keys must be present (DESIGN.md "Ask call sequence" step 3).
// `terminal` is always empty: there is no terminal session behind a web page.
export function buildQuestion(message, context, systemInfo) {
    const s = v => ({ t: "s", v });
    return {
        message: s(message),
        stdin: { t: "a{sv}", v: { stdin: s("") } },
        attachment: { t: "a{sv}", v: { contents: s(context), mimetype: s("text/plain") } },
        terminal: { t: "a{sv}", v: { output: s("") } },
        systeminfo: {
            t: "a{sv}",
            v: {
                os: s(systemInfo.os),
                version: s(systemInfo.version),
                arch: s(systemInfo.arch),
                id: s(systemInfo.id),
            }
        },
    };
}

export async function askQuestion(userId, question) {
    const [reply] = await call(CHAT, "AskQuestion", "sa{sv}", [userId, question], ASK_TIMEOUT_MS);
    const message = reply?.message?.v;
    if (typeof message !== "string")
        throw new Error("The command-line assistant returned a reply without a message.");
    return message;
}

// The daemon does not persist Q/A; the client must (DESIGN.md step 4).
export async function writeHistory(chatId, userId, question, answer) {
    await call(HISTORY, "WriteHistory", "ssss", [chatId, userId, question, answer]);
}

// [{ chatName, createdAt, question, response }] across every chat, in clad's
// order. clad answers an empty history with HistoryNotAvailableError; that is
// an empty list here, not an error.
export async function getHistory(userId) {
    let reply;
    try {
        [reply] = await call(HISTORY, "GetHistory", "s", [userId]);
    } catch (ex) {
        if (hasErrorName(ex, ".HistoryNotAvailableError"))
            return [];
        throw ex;
    }
    return (unwrap(reply?.histories) || []).map(h => ({
        chatName: unwrap(h["chat-name"]),
        createdAt: unwrap(h["created-at"]),
        question: unwrap(h.question),
        response: unwrap(h.response),
    }));
}

export function isHistoryNotEnabled(ex) {
    return hasErrorName(ex, ".HistoryNotEnabledError");
}

export async function clearHistory(userId, chatName) {
    await call(HISTORY, "ClearHistory", "ss", [userId, chatName]);
}

// Every chat's history for this user, including what `c` wrote. Chats are kept.
export async function clearAllHistory(userId) {
    await call(HISTORY, "ClearAllHistory", "s", [userId]);
}
