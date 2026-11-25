# AGENTS.local

Project rules for this DSH plugin bundle.
This file supplements [AGENTS.md](AGENTS.md); read that file first.
Adjust or extend this file for the project.
Where the two conflict, this file wins.

## Scope

This bundle keeps watched sessions in a section above the session list.
Dragging a session opens a temporary drop row that adds it to the section.
The client saves the ordered session IDs and Watch Mode toggle as view preferences.
The detail-page switch (`plugins.bundle.config`, and `plugins.detail.section` when included
in an aggregate bundle) turns on Watch Mode, replacing eye icons with watches,
changing the title to **Watches**, and showing total session runtimes for watched sessions only
from the Host's authenticated `/api/watched-sessions/runtime` endpoint via `ctx.sessionQuery`.
The section header layout and styling match `dsh-background-jobs-sidebar`, while clicking it cycles all,
collapsed, and Needs attention like `dsh-session-list-toggle`, with the same attention criterion.
Keep the native workspace membership, regular pin, filter, and ordering semantics when adapting the browser.

## Project documentation

- `README.md` is for users: installation, usage, commands, and limits.
  Provide `README.zh.md` as its Chinese version.
- `DESIGN.md` records the design, domain semantics, and invariants.
  Keep implementation status, schedules, and debugging notes out of it.
- `CHANGELOG.md` records changes for developers.
- Keep design records, proposals, and verification evidence under `docs/`, with `docs/README.md` as the index.
- Keep the plugin detail page short.
  Set `meta.title` and `meta.description` in `locale/*.json` for the DSH interface language.
  Use `meta.detail` in each locale to select a short, packaged Markdown document when needed.
  Link to the guide with an absolute HTTPS URL and put usage entry points, compatibility, and installation steps there.
  Add one localized preview when it helps explain the feature.
  Use DSH's detail page slots for interactive controls.

## Language

- For the main README, prefer English and provide a Chinese version.
- Prefer Chinese for designs and documentation.
- Keep user-facing text translatable through the project's localization mechanism,
  and maintain all eight locales (`en`, `zh`, `ja`, `de`, `es`, `fr`, `pt`, `ru`) together.
- Use English for code identifiers and keep established technical terms in English when helpful
  for precision or searchability.

## Structure

- Use TypeScript for plugin source unless otherwise specified.
  For TypeScript plugins, use the workspace TypeScript base.
  Put Host, Client, and private module sources under `src/host/`, `src/client/`, and `src/lib/` as needed.
  `npm run build:tools` compiles `scripts/*.mts` to adjacent `.mjs` files for the build and version checks.
  The build generates `client.js` and `index.js` from the TypeScript entries.
  Git ignores the generated files.
  Include the runtime files in the npm package.
- Keep Plugin Manager metadata in `locale/*.json` and runtime translations in `LABELS` in the Client source.
- Node.js 22.18 or newer runs the `.test.mts` files directly.
  The client test uses a fake `ctx` to check registration, resources, and cleanup.
- `docs/scripts/reflow` is the standalone documentation formatter and requires Python 3.11 or newer.

## Reusing native DSH UI

- Prefer native DSH components, behavior, theme tokens, and layouts from comparable screens
  to reduce code and maintenance.
- Prefer runtime reuse through supported slots, component factories,
  or host-provided modules when performance is acceptable.
  Let the host supply the implementation and write only the code needed to fill gaps in existing components
  and extension points.
- When statically importing or bundling official code or assets, annotate the reference
  with the upstream package, version or commit, source path, and symbol name.
  Keep applicable licenses and attribution so future updates can be traced to the source.

## Implementation

- Keep the bundle independently installable and toggleable.
  Keep runtime modules private to this bundle and put shared tools in the workspace `tools/` directory.
- Implement the feature through supported DSH plugin APIs and extension points.
  Keep DSH source and installed files intact.
  Do not patch global behavior or override DSH internals.
  If the available extension points are insufficient, report the limitation and keep the implementation
  within the supported scope.
- Reuse the DSH type declarations for the supported runtime version.
  Preserve types across plugin interfaces, configuration, and events.
  Validate and narrow unknown inputs, and keep the type dependencies in sync.
- Keep the factory free of side effects.
  Register resources in `apply` with `ctx.effect` or `ctx.on` and return cleanup functions.
- Prefer recognizable icons for common action buttons, and use visible text only
  when an icon alone would leave the action unclear.
- Replace the placeholder icon with original artwork and update the title and description
  in all eight locale files before release.
- Resolve every scaffold placeholder before release.

## Versioning

Major version upgrades are the user's decision; regular iterations stay on the current major version.
Update `CHANGELOG.md` when releasing.

## Verification

- Use `npm install` to install dependencies and build a source checkout.
  Run `npm test` to build and test, and `npm run check` to verify types and the local build artifacts.
  `npm pack --dry-run --json` checks the built package.
- From the workspace root, run `node tools/new-dsh-plugin/cli.mts --check plugins/<id>` to check the manifest,
  locale JSON, and the other scaffold files.
- Use a disposable profile for installation tests.
  Distinguish fixture results from observations in the UI.
- After a DSH upgrade, run the tests and verify the behavior in the running UI.
  Record what to verify.

## Markdown

- Run `docs/scripts/reflow md <path>` to format edited Markdown.
- Run `prek install` once per checkout to format staged Markdown at commit time.
  Keep the generated `AGENTS.md` byte-for-byte identical to the shared template.
- When committing in the DSH sandbox, use `PREK_HOME="${TMPDIR:?}/prek-dsh" git commit -m "<commit message>"`
  to run the reflow hook with a writable cache and log directory.
