# Licensing

This document explains VatioBoard's intended licensing model. It is not legal advice.

## Summary

VatioBoard Community Edition is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

Copyright (c) 2026 VatioLibre Inc.

Commercial licenses are available from VatioLibre Inc.

## Why AGPL

VatioBoard is browser software that can be modified, redistributed, or hosted for users over a network. AGPL-3.0-or-later was selected so Community Edition users can study, modify, and share the software while ensuring that modified network deployments also share corresponding source with their users.

The goal is a sustainable commons: useful local-first tools remain available to the community, and organizations that need proprietary or enterprise terms can support the project through commercial licensing.

## Community Edition Rights

Under AGPL-3.0-or-later, Community Edition users can generally:

- run VatioBoard
- study the source code
- modify the software
- share copies
- share modified versions under the same license

The AGPL text in [`../LICENSE`](../LICENSE) is the controlling license text.

## Network-Use Obligations

AGPL includes obligations for modified versions used over a network. If you modify VatioBoard and make that modified version available for users to interact with remotely through a computer network, you must comply with AGPL source-offer requirements for that modified version.

Teams planning hosted deployments should review the AGPL obligations carefully with qualified counsel.

## Commercial Licensing

Commercial licensing is recommended for organizations that need terms outside AGPL-3.0-or-later, such as:

- proprietary deployments
- hosted SaaS deployments
- OEM integrations
- white-label products
- embedded deployments
- enterprise redistribution

See [`../COMMERCIAL-LICENSE.md`](../COMMERCIAL-LICENSE.md). That file does not grant commercial rights by itself; separate written terms are required.

## Sustainability

Commercial licensing gives organizations a way to fund ongoing maintenance, product development, support, and enterprise-oriented work while keeping a strong Community Edition available under AGPL-3.0-or-later.

## Centralized Copyright

VatioLibre Inc. retains centralized copyright for VatioBoard project code so it can maintain consistent licensing, enforce the Community Edition license when needed, and offer commercial licenses without fragmenting rights across many unrelated copyright holders.

Do not use "and contributors" in VatioLibre copyright statements.

## Contributions

Contributors must grant VatioLibre Inc. rights compatible with the dual licensing model. Non-trivial contributions require a Contributor License Agreement or equivalent written agreement.

By contributing to VatioBoard, you agree that your contributions may be distributed under AGPL-3.0-or-later and may also be used, sublicensed, or commercially licensed by VatioLibre Inc. under a Contributor License Agreement or equivalent written agreement.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Third-Party Notices

Third-party dependencies, assets, data, and media remain governed by their own licenses and notices. VatioLibre Inc. does not claim ownership of third-party code or content.

Known notice areas include:

- npm dependency licenses reported by `pnpm licenses list`
- map and tile attribution links in the application
- OpenStreetMap-derived camera data obligations and attribution
- demo music attributions in `README.md`
- Rezmason/matrix Code Rain visualizer runtime and assets under MIT in `public/vendor/rezmason-matrix/`

Preserve third-party copyright and license notices when redistributing VatioBoard or modified versions.

## Dependency License Audit Snapshot

The current npm dependency graph reports these license groups through `pnpm licenses list --json`:

| License             | Package/version count |
| ------------------- | --------------------: |
| MIT                 |                   166 |
| ISC                 |                    23 |
| Apache-2.0          |                    16 |
| BSD-2-Clause        |                    10 |
| BSD-3-Clause        |                     8 |
| BlueOak-1.0.0       |                     3 |
| MIT-0               |                     2 |
| MPL-2.0             |                     2 |
| (MIT OR Apache-2.0) |                     1 |
| 0BSD                |                     1 |
| CC0-1.0             |                     1 |
| Unknown             |                     1 |

Review items:

- `@mapbox/jsonlint-lines-primitives@2.0.2` reports `Unknown`; verify its license before distribution.
- `@jaames/iro@5.5.2` and `@irojs/iro-core@1.2.1` report MPL-2.0; preserve file-level MPL notices and confirm compliance for commercial distributions.
- BlueOak-1.0.0, CC0-1.0, 0BSD, MIT, ISC, BSD, and Apache-2.0 dependencies are generally permissive, but their notices and attribution terms still need to be preserved.
