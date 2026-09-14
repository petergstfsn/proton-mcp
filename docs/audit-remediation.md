# September 2026 audit remediation

This change addresses the repository audit against commit `c57f321c92c6e5ab5a47b68e03b0dca310263605`. It changes local CLI/MCP behavior; it does not publish a release or perform mailbox operations.

| Audit issue | Implementation and regression evidence |
|---|---|
| S1: action allowlist bypasses | Shared MCP mutation classification covers delete, thread, bulk and generic system-flag routes; CLI move/delete apply the corresponding action permission. Actual MCP dispatch tests reject alternate routes before I/O and retain permitted read operations. |
| S2–S3: CLI reply/forward restrictions | CLI recipient checks, confirmation and dry-run precede delivery. The shared SMTP service also enforces send permission and all recipient fields. Actual CLI tests verify rejected recipients, missing confirmation, previews and a permitted send. |
| S4, S7: unsafe decrypted file writes | Shared private output handling validates root ancestry and descendant directories, rejects symlinks, creates missing directories privately and atomically replaces explicit destinations with mode-0600 files. Default attachment saves preserve exclusive creation and collision suffixes. Tests cover dangling/parent symlinks, unsafe writable ancestors, fresh roots, traversal, overwrite and normal saves. |
| S5–S6: installer secrets | Config and backups use private atomic replacement. Standalone and CLI output omit credential-bearing configuration. Tests check file permissions, retained config values and absence of sentinel credentials from actual standalone stdout. |
| S8: resource attachment limit | Shared attachment retrieval checks actual content length before base64 encoding, including checksum IDs. Resource/tool tests reject over-limit inline content and allow bounded reads and explicit disk saves. |
| Queued and manual delivery state | Once SMTP starts, unknown outcomes retain the draft claim. Definite pre-send rejection can release it. Successful delivery cannot become sendable because queue persistence failed. Failure-injection tests cover persistence errors, manual-send ambiguity and timeout followed by late success. |
| Full-sync gaps | A persisted forward cursor fetches every bounded interval after initial backfill. A regression spans 900 arriving UIDs in 18 batches with SQLite close/reopen between batches. |
| Metadata loss | Metadata-only summaries preserve parsed references, thread identity and attachment checksum IDs, including migration from legacy email IDs. SQLite tests cover the migrated representation. |
| Stale deleted mail and folders | Every confirmed observed UID range reconciles expunges; repeated full syncs cycle through bounded history. Only a successfully completed folder listing authorizes removal of missing folders. Tests distinguish complete and partial folder lists. |
| Hanging timeout | Hard timeouts close the connection directly; normal logout has a bounded grace period. A hanging-client regression checks forced cleanup. |
| Docker and Homebrew | Docker includes source in a build stage and runs a separate unprivileged runtime stage. CI builds the image and checks imports/native SQLite. The formula pins upstream 2.0.8 with a SHA-256 computed from its npm archive. |
| Documentation and release drift | Privacy text distinguishes Bridge transport from model-provider processing. The unread example uses the count tool's structured result. Version consistency is checked in CI, the broken tap gitlink is removed, and fork publishing to the upstream namespace is disabled. |

Additional hardening addresses the audit's conditional concerns: label selection requires one exact raw-content match; label-copy and empty-folder mutations recheck mailbox generation under the mutation lock; authentication headers are explicitly unverified; parsing and serialized cache content are bounded at 64 MiB; thread traversal is iterative and tested with a 15,000-message chain.

The focused tests are in `test/audit-regressions.test.mjs`, alongside the existing repository suite. They invoke compiled public handlers with synthetic messages and prohibit network sockets. Independent read-only boundary investigation and candidate review were performed; the latter identified the fresh-root and ancestor-validation cases now covered by regressions.

## Verification and limits

Run `npm run ci` for release metadata, type checking, build/import smoke and the full test suite. Run `npm run release:check` to add the package dry run. GitHub CI covers Node 20, 22 and 24, dependency auditing and a container build/runtime smoke test.

Local synthetic verification does not establish real Proton Bridge behavior or SMTP delivery. Live mailbox mutation tests were not performed. A local Docker daemon was unavailable; the container check is delegated to CI. The Homebrew archive digest and Ruby syntax were checked, but a clean Homebrew installation was not exercised.

Exact raw-content label matching deliberately refuses ambiguous or differently represented copies. Legacy IDs cannot establish their original mailbox generation; callers should obtain fresh IDs. Markerless legacy storage adopts the configured account and requires operator care during migration. Filesystem protection excludes other processes with the credential owner's UID and privileged system processes; Windows uses directory ACLs. Uncertain delivery requires reconciliation against Sent before creating another sendable draft. Published upstream npm/Homebrew artifacts do not contain these unpublished fork changes.
