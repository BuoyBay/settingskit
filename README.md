# Typed settings store

Independent small-settings core. No FormatKit, TemporalKit or FieldKit dependency. Supported value kinds are text,
Boolean and exact Int64; no floating-point coercions or nullable values.

Keys, text values, choices, kinds, JSON member/escape names and optimistic storage
comparisons are case sensitive. Case-only edits are real changes. Key export and
change notifications use ordinal ASCII order, matching the browser companion.

## Install

From a Buoy consumer project with BPM installed:

```sh
bpm add settingskit --git https://github.com/BuoyBay/settingskit.git --rev refs/heads/main
```

BPM records the resolved commit in its lockfile. Keep that lockfile with the
consumer project for reproducible installs.
BPM also resolves `atomicfilekit`.

## API entrypoints

- `SettingsRule(key, kind, defaultText, minimum, maximum, choices)`
- `SettingsSchema(version, rules)`
- `Validate(values)`
- `SettingsPair(key, value)`
- `Settings(schema, store, migration)`

## Build from source

With the native `build-packages` driver from [devtools](https://github.com/BuoyBay/devtools)
on your `PATH`, run from this checkout:

```sh
build-packages --root "$PWD" --compile-consumer settingskit
```

The driver checks source targets and compiles an import consumer. See the
[API guide](docs/API.md) for behavior, limits and any host prerequisites.

## Local Buoy setup

On your own machine, install Buoy and run:

```sh
buoy ai init --both
```

## Contributing

[Contributing](CONTRIBUTING.md) · [License](LICENSE)
