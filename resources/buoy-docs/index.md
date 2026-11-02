# SettingsKit 0.1

Independent small-settings core. No FormatKit, TemporalKit or FieldKit dependency. Supported value kinds are text,
Boolean and exact Int64; no floating-point coercions or nullable values.

Keys, text values, choices, kinds, JSON member/escape names and optimistic storage
comparisons are case sensitive. Case-only edits are real changes. Key export and
change notifications use ordinal ASCII order, matching the browser companion.

API: `SettingsRule(key, kind, defaultText, minimum, maximum, choices)` declares
`text`, `integer` or `boolean` values. Integer text is canonical signed Int64;
Boolean text is `true`/`false`. Text length uses Unicode scalar counts for minimum/maximum; integer bounds
use them numerically. Empty choices allows any otherwise valid value.
`SettingsSchema(version, rules)` copies rules; override `Validate(values)` for
cross-field checks (throw to reject). Rules and pairs expose read methods only.
`SettingsPair(key, value)` represents one override. `SettingsMigration.Step(from,
values)` must return the overrides for exactly the next version; the default
implementation rejects missing migration steps.

`Settings(schema, store, migration)` loads and validates storage. `Get(key)`
returns effective canonical text; `GetInteger` and `GetBoolean` enforce kind.
`Revision()`, `Export()`, `Snapshot()` (identical immutable JSON text),
`IsFuture()`, `Persistence()` and `NotificationFailed()` inspect state.
`Apply(pairs, expectedRevision, origin)` merges overrides; `Import(text, expected,
origin)` replaces them after sequential migration; `Reset(key, expected, origin)`
and `ResetAll(expected, origin)` remove owned overrides. Unknown/duplicate keys,
invalid values, bounds or stale revisions throw. Expected revision is mandatory.
Default-valued overrides collapse. A no-op does not write, increment or notify.
Changed keys are sorted; default-valued overrides are removed before comparison. Subclass `Settings`, `Handle Changed(keys As Array Of String, origin As
String, revision As Integer)`. One event per successful changed batch; mutation
and import during notification are rejected. Observer exceptions are contained,
reported by NotificationFailed; committed state remains committed.

Wire format is deterministic UTF-8 JSON:
`{"version":"1","revision":"0","values":{"key":"value"}}`.
All integers are strings, including revisions (0..2147483647), versions (1..1000)
and setting Int64s. Keys remain ASCII and are sorted ordinally. Values support
Unicode literals, including euro symbols, NBSP, narrow NBSP and supplementary
codepoints. Input allows JSON whitespace, member reordering, quote/slash/backslash/
`n`/`r`/`t` escapes, and `\uXXXX` codepoints with strict surrogate pairing.
Export emits literal UTF-8 for Unicode and standard escapes for quotes/backslash
and newline/carriage-return/tab. Unicode normalization is never applied.
Malformed/overlong/truncated UTF-8, surrogate scalars, lone JSON surrogates, NUL
(raw or escaped), other C0 controls, duplicate decoded keys, unknown envelope
fields, trailing content and non-string values are rejected before any runtime
JSON parser is invoked (none is used). `\b`/`\f` are rejected controls.
Bounds: 65536 input/output UTF-8 bytes, 128 keys/rules, 64-byte nonempty ASCII
keys, 4096 UTF-8 bytes per value. File loading reads bounded raw bytes and validates
UTF-8 and NUL before creating a String. `SettingsWire.CheckBytes(data,limit)` is
available for callers receiving raw input from other transports; validate raw
bytes before converting to String. String APIs cannot recover bytes a caller's
prior decoding discarded. A leading BOM is not an envelope and is rejected.
Future versions retain their exact raw input, expose defaults, and reject every
mutation including reset/import. They are never migrated down or overwritten.
Import keeps local revision chronology; incoming revision is metadata only.
Loaded old versions migrate in memory; the next changed batch persists current
version. Migration must return only owned valid keys at its final step.

Stores: `SettingsMemoryStore()` is process memory; `SettingsFileStore(path)` is
device-local plain text via AtomicFileKit staged write, file flush and atomic
replace on supported local filesystems; parent directory fsync/full crash
durability is not supplied; `SettingsPrefsStore(domain,key)` owns exactly one native
Prefs key and reports `prefs-visible-durability-unverified`. Read-back is visibility,
not fsync. Pre-publication failure keeps the previous in-memory state. AtomicFileKit
recovery errors retain its explicit paths in the thrown exception. A committed
replacement with failed backup cleanup advances in-memory state and reports
`file-committed-cleanup-error`; `SettingsFileStore.CleanupError()` retains the
message and recovery path. Ordinary file success reports
`file-atomic-visible-directory-durability-unverified`. The file store requires trusted parent directories and inherits AtomicFileKit
metadata/symlink/hard-link restrictions. File reads are bounded to at most 65536 bytes and require an exact count; the
single-writer assumption still applies to obtaining a coherent file snapshot.
Store `Save(expectedRaw,newRaw)` compares raw contents before
writing; this detects sequential stale writers, not simultaneous processes.
Use one writer per store; no locks or cross-process CAS are claimed. Subclass
`SettingsStore` for account scope with a caller-provided authenticated transport
and real server CAS, returning an honest status from `Status()`. There is no
backend, account sync, encryption or secret storage supplied here.

`SettingsMemoryStore.FailWrites` injects rejected writes. All failed validation,
conflict and pre-publication store writes preserve in-memory state/revision and send no event.
Schema/migration/store callbacks must be synchronous and must not mutate an
active engine; the engine blocks reentrancy across the whole transaction.

Browser companion: `resources/browser.mjs` exports `BrowserSettings`, `MemoryStorage` and
`parseDocument`. BrowserSettings takes `{version,rules,validate,migrate,storage,
key,eventTarget}`. Rules use `{key,kind,default,minimum,maximum,choices}` with
canonical string values, matching native contracts; integer bounds are BigInts.
Text ranges count Unicode scalars, while wire limits count UTF-8 bytes.
Methods `get`, `export`, `snapshot`, `apply`, `import`, `reset`, `resetAll`,
`subscribe`, `refresh`, `close`. Read-only properties `revision`, `isFuture`,
`persistence` expose state; `notificationFailed` reports observer errors. `apply` etc take expected revision (string) and
origin. Listener receives `{keys,origin,revision}`. localStorage is browser/origin
local, best-effort, quota/security errors propagate with no local commit. Storage
events refresh only the owned key/storage area; invalid external documents retain
local state and call `onError`. Valid external changes notify once as `storage`;
future data is preserved read-only. Revisions and raw pre-write comparison detect
sequential conflicts; localStorage provides no atomic cross-tab compare-and-set.
Call `refresh` to resolve a stale writer; same-revision divergent documents are
accepted as external replacements and notified. Account adapters require caller
transport; browser-local storage never means account preferences.

Install the `atomicfilekit` 0.1.0 dependency alongside this package. The sealed
archive includes the standalone companion at `resources/browser.mjs` and this
contract at `resources/buoy-docs/index.md`. No runtime JSON dependency is needed. An existing empty file, Prefs string or
localStorage value is corrupt; only absent storage initializes defaults.
