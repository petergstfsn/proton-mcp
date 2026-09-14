import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { simpleParser } from "mailparser";
import { createServer, buildConfigFromEnv, buildSecurityInfo } from "../dist/index.js";
import { main as cliMain } from "../dist/cli.js";
import { SimpleIMAPService } from "../dist/services/simple-imap-service.js";
import { SMTPService, SendNotAttemptedError } from "../dist/services/smtp-service.js";
import { LocalIndexService } from "../dist/services/local-index-service.js";
import { DraftStoreService } from "../dist/services/draft-store-service.js";
import { DeliveryQueueService } from "../dist/services/delivery-queue-service.js";
import { createEmailId } from "../dist/utils/helpers.js";
import { writePrivateFile } from "../dist/utils/private-file.js";
import { installClaudeDesktopConfig, installStatusForOutput } from "../dist/scripts/install-claude-desktop.js";

// No regression test in this file may reach a real mailbox or SMTP server.
net.Socket.prototype.connect = () => { throw new Error("Network disabled in audit regression tests"); };
tls.connect = () => { throw new Error("Network disabled in audit regression tests"); };
for (const key of Object.keys(process.env)) if (key.startsWith("PROTONMAIL_")) delete process.env[key];
Object.assign(process.env, { PROTONMAIL_USERNAME: "owner@example.com", PROTONMAIL_PASSWORD: "synthetic-test", PROTONMAIL_AUTO_SYNC: "false", PROTONMAIL_STARTUP_SYNC: "false", PROTONMAIL_IDLE_WATCH: "false" });
const id = createEmailId("INBOX", 1, "1");
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "proton-audit-regression-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = buildConfigFromEnv();
  config.dataDir = join(root, "data");
  config.runtime.allowFileDownloadDir = join(root, "downloads");
  await mkdir(config.runtime.allowFileDownloadDir, { mode: 0o700 });
  return { root, config };
}

async function mcp(t, config) {
  const services = createServer(config, { startBackgroundSync: false });
  const client = new Client({ name: "audit-regression", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await services.server.connect(st);
  await client.connect(ct);
  t.after(async () => { await client.close(); await services.server.close(); });
  return { ...services, client };
}

test("actual MCP alternate mutation routes enforce action restrictions before I/O", async t => {
  const { config } = await fixture(t);
  config.runtime.allowedActions = ["mark_read"];
  config.runtime.allowEmptyFolder = true;
  const { client, imapService } = await mcp(t, config);
  let calls = 0;
  for (const name of ["deleteEmail", "emptyFolder", "bulkDelete", "moveThread", "deleteThread", "flagThread", "updateMessageFlags", "bulkUpdateFlags"]) {
    imapService[name] = async () => { calls++; return {}; };
  }
  const cases = [
    ["delete_email", { emailId: id, confirmed: true }],
    ["empty_folder", { folder: "Trash", confirmed: true }],
    ["bulk_delete", { emailIds: [id], permanent: false }],
    ["bulk_delete", { emailIds: [id], permanent: true, confirmed: true }],
    ["move_thread", { messageId: "<x@test>", destination: "Archive" }],
    ["delete_thread", { messageId: "<x@test>", permanent: false }],
    ["flag_thread", { messageId: "<x@test>", flagsToAdd: ["\\fLaGgEd"] }],
    ["update_message_flags", { emailId: id, flagsToRemove: ["\\SEEN"] }],
    ["bulk_update_flags", { emailIds: [id], flagsToAdd: ["\\Deleted"] }],
  ];
  for (const [name, args] of cases) await assert.rejects(() => client.callTool({ name, arguments: args }), /disabled/);
  assert.equal(calls, 0);
  await client.callTool({ name: "update_message_flags", arguments: { emailId: id, flagsToAdd: ["\\Seen"] } });
  assert.equal(calls, 1, "permitted read action remains usable");
  await client.callTool({ name: "update_message_flags", arguments: { emailId: id, flagsToAdd: ["constructor"] } });
  assert.equal(calls, 2, "custom keywords remain governed by mailbox write policy");
});

test("actual CLI reply/forward and move/delete enforce policy, confirmation and preview", async t => {
  const { config } = await fixture(t);
  const oldEnv = { ...process.env };
  Object.assign(process.env, { PROTONMAIL_DATA_DIR: config.dataDir, PROTONMAIL_RESTRICT_OUTBOUND_TO_SELF: "true", PROTONMAIL_CONFIRM_DESTRUCTIVE: "true", PROTONMAIL_ALLOWED_ACTIONS: "mark_read" });
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in oldEnv)) delete process.env[k]; Object.assign(process.env, oldEnv); });
  let recipient = "external@example.net";
  let sends = 0;
  t.mock.method(SimpleIMAPService.prototype, "getEmailById", async () => ({ id, subject: "fixture", from: [{ address: recipient }], to: [{ address: "owner@example.com" }], cc: [], bcc: [], replyTo: [], text: "private fixture", attachments: [], messageId: "<test@example.com>" }));
  t.mock.method(SimpleIMAPService.prototype, "disconnect", async () => {});
  t.mock.method(SMTPService.prototype, "sendEmail", async input => { sends++; return { messageId: "mock", accepted: input.to }; });
  t.mock.method(process.stdout, "write", () => true);
  const oldArgv = process.argv;
  t.after(() => { process.argv = oldArgv; });
  const cli = async args => { process.argv = [process.execPath, "cli", ...args]; return cliMain(); };
  await assert.rejects(() => cli(["move", id, "Archive"]), /disabled/);
  await assert.rejects(() => cli(["delete", id, "--confirmed"]), /disabled/);
  for (const command of ["reply", "forward"]) {
    const args = [command, id, "--body", "note", "--to", recipient, "--json"];
    await assert.rejects(() => cli([...args, "--confirmed"]), /RESTRICT_OUTBOUND/);
  }
  recipient = "owner@example.com";
  for (const command of ["reply", "forward"]) {
    const args = [command, id, "--body", "note", "--to", recipient, "--json"];
    await assert.rejects(() => cli(args), /Confirmation required/);
    await cli([...args, "--dry-run", "--confirmed"]);
    assert.equal(sends, command === "reply" ? 0 : 1);
    await cli([...args, "--confirmed"]);
  }
  assert.equal(sends, 2, "confirmed self sends remain usable");
});

test("SMTP shared boundary checks all recipients but does not block draft composition", async t => {
  const { config } = await fixture(t);
  config.runtime.restrictOutboundToSelf = true;
  const smtp = new SMTPService(config);
  let calls = 0;
  smtp.transporter = { sendMail: async () => { calls++; return {}; } };
  const input = { to: ["owner+tag@example.com"], subject: "test", body: "body" };
  for (const field of ["to", "cc", "bcc"]) await assert.rejects(() => smtp.sendEmail({ ...input, [field]: ["external@example.net"] }), SendNotAttemptedError);
  assert.equal(calls, 0);
  await smtp.sendEmail(input);
  assert.equal(calls, 1);
  config.runtime.allowSend = false;
  await assert.rejects(() => smtp.sendEmail(input), SendNotAttemptedError);
  assert.ok((await smtp.buildRawMessage(input)).length > 0);
});

test("inline saves, explicit attachment saves and exports reject symlinks and privately replace files", async t => {
  const { root, config } = await fixture(t);
  const { client, imapService } = await mcp(t, config);
  const attachment = { id: "a", filename: "fixture.bin", content: Buffer.from("private fixture"), contentType: "application/octet-stream" };
  imapService.getParsedAttachment = async () => attachment;
  imapService.withMailbox = async (_f, _r, fn) => fn({ mailbox: { uidValidity: 1n }, fetchOne: async () => ({ source: Buffer.from("raw fixture") }) });
  const save = saveTo => client.callTool({ name: "get_attachment_content", arguments: { emailId: id, attachmentId: "a", saveTo } });
  const oldMask = process.umask(0o022);
  t.after(() => process.umask(oldMask));
  await rm(config.runtime.allowFileDownloadDir, { recursive: true });
  await save("nested/file.bin");
  const output = join(config.runtime.allowFileDownloadDir, "nested/file.bin");
  if (process.platform !== "win32") assert.equal((await stat(output)).mode & 0o777, 0o600);
  await writeFile(output, "old");
  await save("nested/file.bin");
  assert.equal(await readFile(output, "utf8"), "private fixture");
  await assert.rejects(() => save("../escape.bin"), /escapes/);
  if (process.platform === "win32") return; // Symlink creation requires separate Windows privileges.
  const unsafeAncestor = join(root, "shared");
  await mkdir(unsafeAncestor, { mode: 0o777 });
  await chmod(unsafeAncestor, 0o777);
  await assert.rejects(() => writePrivateFile(join(unsafeAncestor, "private"), join(unsafeAncestor, "private/file"), "secret"), /ancestors/);
  await assert.rejects(() => stat(join(unsafeAncestor, "private")), { code: "ENOENT" });
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(join(outside, "absent"), join(config.runtime.allowFileDownloadDir, "dangling"));
  await assert.rejects(() => save("dangling"), /symlink/);
  await assert.rejects(() => imapService.saveAttachment(id, "a", join(config.runtime.allowFileDownloadDir, "dangling")), /symlink/);
  await assert.rejects(() => imapService.exportEmail(id, join(config.runtime.allowFileDownloadDir, "dangling")), /symlink/);
  await assert.rejects(() => stat(join(outside, "absent")), { code: "ENOENT" });
  await imapService.saveAttachment(id, "a");
  const secondId = createEmailId("INBOX", 2, "1");
  await symlink(outside, join(config.dataDir, "attachments", encodeURIComponent(secondId)));
  await assert.rejects(() => imapService.saveAttachment(secondId, "a"), /real directory/);
  await assert.rejects(() => stat(join(outside, "fixture.bin")), { code: "ENOENT" });
  await symlink(outside, join(config.runtime.allowFileDownloadDir, "parent"));
  await assert.rejects(() => save("parent/new/file.bin"), /real directory/);
  await assert.rejects(() => stat(join(outside, "new")), { code: "ENOENT" });
});

test("installer writes private config/backups and output omits credential values", async t => {
  const { root } = await fixture(t);
  const configPath = join(root, "claude", "config.json");
  const options = { configPath, cwd: fileURLToPath(new URL("..", import.meta.url)), useRepoRuntime: true, includeEnv: false, env: { PROTONMAIL_PASSWORD: "sentinel-private-password" } };
  const oldMask = process.umask(0o022);
  t.after(() => process.umask(oldMask));
  await installClaudeDesktopConfig(options);
  const result = await installClaudeDesktopConfig(options);
  for (const path of [configPath, result.backupPath]) {
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok((await readFile(path, "utf8")).includes("sentinel-private-password"));
  }
  assert.ok(!JSON.stringify(installStatusForOutput(result)).includes("sentinel-private-password"));
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/scripts/install-claude-desktop.js", import.meta.url)), "--use-repo-build", "--config-path", configPath, "--cwd", options.cwd], {
    env: { ...process.env, PROTONMAIL_PASSWORD: "sentinel-private-password" }, encoding: "utf8",
  });
  assert.ok(!stdout.includes("sentinel-private-password"));
  assert.equal(JSON.parse(stdout).configPath, configPath);
});

test("actual attachment resource and tool enforce byte limits for parsed checksum IDs", async t => {
  const { config } = await fixture(t);
  config.runtime.maxInlineBytes = 1;
  const { client, imapService } = await mcp(t, config);
  const payload = Buffer.alloc(2048, 65);
  const parsed = await simpleParser(Buffer.from('Content-Type: application/octet-stream; name="fixture.bin"\r\nContent-Disposition: attachment; filename="fixture.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + payload.toString("base64")));
  const attachment = imapService.mapParsedAttachmentsWithContent(parsed)[0];
  imapService.withMailbox = async (_f, _r, fn) => fn({ fetchOne: async () => ({ bodyStructure: { type: "application/octet-stream", part: "1", size: payload.length } }) });
  imapService.getParsedMailDetail = async () => ({ detail: { id }, parsed });
  const uri = `protonmail://attachment/${encodeURIComponent(id)}/${attachment.id}`;
  await assert.rejects(() => client.readResource({ uri }), /too large/);
  await assert.rejects(() => client.callTool({ name: "get_attachment_content", arguments: { emailId: id, attachmentId: attachment.id, includeBase64: true } }), /too large/);
  config.runtime.maxInlineBytes = 2;
  assert.equal(Buffer.from((await client.readResource({ uri })).contents[0].blob, "base64").length, 2048);
  config.runtime.maxInlineBytes = 1;
  await client.callTool({ name: "get_attachment_content", arguments: { emailId: id, attachmentId: attachment.id, saveTo: "large.bin" } });
  assert.equal((await stat(join(config.runtime.allowFileDownloadDir, "large.bin"))).size, 2048);
});

test("queue persistence failure after SMTP never releases the draft, including after restart", async t => {
  const { config } = await fixture(t);
  const drafts = new DraftStoreService(config, quiet);
  let sends = 0;
  const queue = new DeliveryQueueService(config, { sendEmail: async () => { sends++; return { messageId: "sent", accepted: ["owner@example.com"] }; } }, quiet);
  queue.setDraftStore(drafts);
  const draft = await drafts.createDraft({ to: ["owner@example.com"], subject: "test", body: "body" });
  const item = await queue.enqueue({ to: draft.to, subject: draft.subject, body: draft.body }, new Date(0).toISOString(), "scheduled_send", draft.id);
  const save = queue.save.bind(queue);
  queue.save = async store => { if (store.items[item.id]?.status === "sent") throw new Error("EIO after delivery"); return save(store); };
  await queue.checkDue();
  assert.equal(sends, 1);
  await assert.rejects(() => drafts.claimForSending(draft.id), /not sendable/);
  const reopened = new DraftStoreService(config, quiet);
  await assert.rejects(() => reopened.claimForSending(draft.id), /not sendable/);
});

test("definite pre-send errors safely release a queued draft", async t => {
  const { config } = await fixture(t);
  const drafts = new DraftStoreService(config, quiet);
  const queue = new DeliveryQueueService(config, { sendEmail: async () => { throw new SendNotAttemptedError("invalid content"); } }, quiet);
  queue.setDraftStore(drafts);
  const draft = await drafts.createDraft({ to: ["owner@example.com"], subject: "test", body: "body" });
  await queue.enqueue({ to: draft.to, subject: draft.subject, body: draft.body }, new Date(0).toISOString(), "scheduled_send", draft.id);
  await queue.checkDue();
  assert.equal((await drafts.getDraft(draft.id)).status, "draft");
});

test("manual send_draft keeps an ambiguous SMTP result non-sendable", async t => {
  const { config } = await fixture(t);
  const { client, draftStore, smtpService } = await mcp(t, config);
  const draft = await draftStore.createDraft({ to: ["owner@example.com"], subject: "test", body: "body" });
  smtpService.sendEmail = async () => { throw new Error("socket lost after DATA"); };
  await assert.rejects(() => client.callTool({ name: "send_draft", arguments: { draftId: draft.id, confirmed: true } }));
  await assert.rejects(() => draftStore.claimForSending(draft.id), /not sendable/);
});

test("hard operation timeout closes immediately even when graceful logout would hang", async t => {
  const { config } = await fixture(t);
  const imap = new SimpleIMAPService(config, quiet);
  let closed = false;
  imap.client = { usable: true, logout: () => new Promise(() => {}), close: () => { closed = true; } };
  const timer = setTimeout(() => {}, 200);
  t.after(() => clearTimeout(timer));
  await assert.rejects(() => imap.withTimeout(new Promise(() => {}), 5, "deadline"), /deadline/);
  assert.equal(closed, true);
  assert.equal(imap.client, undefined);
});

test("full top-up covers every UID across restart checkpoints, then reconciles history", async t => {
  const { config } = await fixture(t);
  const index = new LocalIndexService(config, quiet);
  t.after(() => index.closeDb());
  const imap = new SimpleIMAPService(config, quiet);
  const mailbox = { exists: 1000, uidNext: 1001, uidValidity: 1n };
  imap.withMailbox = async (_f, _r, fn) => fn({ mailbox, fetch: async function* (range) { const [a, b] = range.split(":").map(Number); for (let uid = a; uid <= b; uid++) yield { uid, seq: uid, flags: new Set(), envelope: { subject: "fixture" } }; } });
  let checkpoint = { folder: "INBOX", uidValidity: "1", highestUid: 100, uidNext: 101, backfilledToUid: 1 };
  const seen = [];
  for (let i = 0; i < 18; i++) {
    const batch = await imap.collectFolderForIndex("INBOX", { full: true, limit: 50, checkpoint, includeAttachmentText: false, syncedAt: new Date().toISOString() });
    seen.push(...batch.emails.map(e => e.uid));
    await index.recordSnapshot({ folders: [], emails: batch.emails, folderStats: [batch.checkpoint], syncedAt: new Date().toISOString() });
    index.closeDb();
    checkpoint = (await index.getSyncCheckpointMap()).INBOX;
  }
  assert.deepEqual(seen, Array.from({ length: 900 }, (_, i) => i + 101));
  assert.equal(checkpoint.highestUid, 1000);
  const next = await imap.collectFolderForIndex("INBOX", { full: true, limit: 50, checkpoint, includeAttachmentText: false, syncedAt: new Date().toISOString() });
  assert.equal(next.checkpoint.reconcileToUid, 951);
});

test("metadata refresh preserves References and checksum IDs; observed expunges and folder deletion reconcile", async t => {
  const { config } = await fixture(t);
  const index = new LocalIndexService(config, quiet);
  t.after(() => index.closeDb());
  const imap = new SimpleIMAPService(config, quiet);
  const metadata = imap.toSummary("INBOX", { uid: 1, seq: 1, flags: new Set(), envelope: { messageId: "<one@test>", subject: "fixture" }, bodyStructure: { type: "application/octet-stream", part: "2", disposition: "attachment", dispositionParameters: { filename: "a.bin" }, size: 10 } }, "1");
  const rich = { ...metadata, detailsComplete: true, references: ["<parent@test>"], attachments: [{ ...metadata.attachments[0], id: "checksum" }] };
  const other = { ...rich, id: createEmailId("INBOX", 2, "1"), uid: 2, messageId: "<two@test>" };
  const folder = { path: "INBOX", name: "INBOX", delimiter: "/", listed: true, subscribed: true, flags: [], messages: 2 };
  const record = (emails, stats, extra = {}) => index.recordSnapshot({ folders: [folder], emails, folderStats: [stats], syncedAt: new Date().toISOString(), ...extra });
  await record([{ ...rich, id: createEmailId("INBOX", 1) }, other], { folder: "INBOX" });
  await record([metadata], { folder: "INBOX", strategy: "incremental_window", rangeStartUid: 1, rangeEndUid: 2 });
  await record([metadata], { folder: "INBOX", strategy: "incremental_window", rangeStartUid: 1, rangeEndUid: 2 });
  const result = await index.search({ folder: "INBOX", limit: 10 });
  assert.equal(result.total, 1);
  assert.deepEqual(result.emails[0].references, ["<parent@test>"]);
  assert.equal(result.emails[0].attachments[0].id, "checksum");
  await index.recordSnapshot({ folders: [], folderListComplete: false, emails: [], folderStats: [], syncedAt: new Date().toISOString() });
  assert.equal((await index.search({ limit: 10 })).total, 1, "partial folder lists must never delete a folder");
  await index.recordSnapshot({ folders: [], folderListComplete: true, emails: [], folderStats: [], syncedAt: new Date().toISOString() });
  assert.equal((await index.search({ limit: 10 })).total, 0);
});

test("label removal requires unique exact content and rechecks source generation before COPY", async t => {
  const { config } = await fixture(t);
  const imap = new SimpleIMAPService(config, quiet);
  let matches = [7]; let labelBody = "different"; let copies = 0; let deletes = 0; let generation = 1n;
  imap.withMailbox = async (folder, readOnly, fn) => fn({ mailbox: { uidValidity: readOnly ? 1n : generation }, fetchOne: async () => ({ uid: 1, envelope: { messageId: "<duplicate@test>" }, source: Buffer.from(folder === "INBOX" ? "original" : labelBody) }), search: async () => matches, messageCopy: async () => { copies++; return true; }, messageDelete: async () => { deletes++; return true; } });
  assert.deepEqual((await imap.updateMessageLabels(id, [], ["Work"])).removed, []);
  labelBody = "original"; matches = [7, 8];
  assert.deepEqual((await imap.updateMessageLabels(id, [], ["Work"])).removed, []);
  assert.equal(deletes, 0);
  matches = [7];
  assert.deepEqual((await imap.updateMessageLabels(id, [], ["Work"])).removed, ["Labels/Work"]);
  assert.equal(deletes, 1);
  generation = 2n;
  await assert.rejects(() => imap.updateMessageLabels(id, ["Work"], []), /before the mailbox changed/i);
  assert.equal(copies, 0);
});

test("emptyFolder rejects a generation change between listing and deletion", async t => {
  const { config } = await fixture(t);
  const imap = new SimpleIMAPService(config, quiet);
  let calls = 0;
  imap.withMailbox = async (_f, readOnly, fn) => fn({ mailbox: { uidValidity: readOnly ? 1n : 2n }, search: async () => [1], messageDelete: async () => { calls++; return true; } });
  await assert.rejects(() => imap.emptyFolder("Trash"), /before the mailbox changed/i);
  assert.equal(calls, 0);
});

test("forged authentication headers are explicitly unverified observations", () => {
  const result = buildSecurityInfo({ headers: { "authentication-results": "attacker.test; dkim=pass; spf=pass" } });
  assert.equal(result.authenticationVerified, false);
  assert.match(result.authenticationWarning, /does not verify/);
});

test("message parsing and cached content have byte bounds", async t => {
  const { config } = await fixture(t);
  const imap = new SimpleIMAPService(config, quiet);
  await assert.rejects(() => imap.parseSource(Buffer.alloc(64 * 1024 * 1024 + 1)), /64 MiB/);
  const body = "x".repeat(8 * 1024 * 1024);
  for (let i = 0; i < 10; i++) imap.cacheMessage(String(i), { id: String(i), preview: body });
  assert.ok(imap.messageCacheBytes <= 64 * 1024 * 1024);
  assert.ok(imap.messageCache.size < 10);
  assert.ok(!imap.messageCache.has("0"));
  assert.ok(imap.messageCache.has("9"));
});

test("very deep thread chains resolve without recursive stack growth", async t => {
  const { config } = await fixture(t);
  const index = new LocalIndexService(config, quiet);
  const messages = Array.from({ length: 15000 }, (_, i) => ({
    canonicalId: `<${i}@test>`, messageId: `<${i}@test>`,
    inReplyTo: i ? `<${i - 1}@test>` : undefined,
    threadId: i === 0 ? "root" : undefined,
    references: [],
  })).reverse();
  const result = index.assignResolvedThreadKeys(messages, "owner@example.com");
  assert.ok(result.every(message => message.threadKey === "imap:root"));
});

test("queued SMTP timeout retains the claim even if delivery completes later", async t => {
  const { config } = await fixture(t);
  const drafts = new DraftStoreService(config, quiet);
  let finishSend;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const pending = new Promise(resolve => { finishSend = resolve; });
  const queue = new DeliveryQueueService(config, { sendEmail: () => { signalStarted(); return pending; } }, quiet);
  queue.setDraftStore(drafts);
  const draft = await drafts.createDraft({ to: ["owner@example.com"], subject: "test", body: "body" });
  await queue.enqueue({ to: draft.to, subject: draft.subject, body: draft.body }, new Date(0).toISOString(), "scheduled_send", draft.id);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = queue.checkDue();
  await started;
  t.mock.timers.tick(30001);
  await run;
  finishSend({ messageId: "late-success", accepted: ["owner@example.com"] });
  await pending;
  await assert.rejects(() => drafts.claimForSending(draft.id), /not sendable/);
});
