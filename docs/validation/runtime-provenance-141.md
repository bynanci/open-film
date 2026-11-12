# Retained runtime provenance and obligations — issue 141

Audit dated 2026-11-11 against commit
`9f4abb8de6f8f20b080c59dd50f1cd64af9dc2d5`.
**Partial provenance evidence; distribution remains blocked.** This supplements
[runtime intake](../runtime-intake-141.md), without changing its
`unreviewed-intake-evidence`, `executed: false`, or
`distributionApproved: false` status. No retained executable/addon was loaded,
new binary/provider selected, workflow dispatched, or legal/signing approval issued.

The [retained inventory](https://github.com/bynanci/open-film/blob/9f4abb8de6f8f20b080c59dd50f1cd64af9dc2d5/docs/evidence/runtime-intake-141/upstream-evidence.json)
has SHA-256
`0fbcca91d06fa10514bdaca0c5c58abcaf144111ac642c2d1dc48a71654dca03`.
Rehashing its **50 distinct retained files, 393,731,195 bytes**, matched every
recorded size and SHA-256. It contains the exact upstream URLs, archive/member
names, binary hashes, npm SHA-512 pins and license-text hashes. The source
archives, extracted inputs and inspection records remain outside the repository.
Names below identify those exact inventory records; they do not select a new
shipping configuration.

## Source and binary correspondence

| Component                                 | Retained source and integrity evidence                                                                                                                                                                           | ABI/build evidence and remaining gap                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node 24.14.0, Windows x64                 | `node-v24.14.0-win-x64.zip` and its `node.exe` member match the official retained SHASUMS; source is `node-v24.14.0.tar.xz`, commit `f657bb8ed86365ff3fdbe32e27563e778b41486a`.                                  | PE32+ machine `0x8664`; OS/subsystem header 6.0. Upstream `BUILDING.md` requires Windows 10/Server 2016 or newer, subject to vendor support; the PE field does not establish Vista support. Source documents the official Windows Server 2022/VS2022 build. Target loader/import baseline and execution remain unobserved.                                                                                         |
| Node 24.14.0, macOS arm64                 | Official archive SHASUM matches; the member SHA-256 is bound by that archive and the inventory. Same source commit. Source and macOS LICENSE bytes match; Windows LICENSE differs only by CRLF line endings.     | Mach-O CPU `0x0100000c`; `LC_BUILD_VERSION` minimum 13.5, SDK 15.0. Retained `config.gypi`: module ABI 137, N-API 10, arm64, non-shared Node/OpenSSL/zlib. Source `node_version.h` confirms ABI 137, N-API maximum 10/default 8. None proves addon loading. No macOS x64 input was collected.                                                                                                                      |
| Koffi 3.3.3, Windows x64/macOS arm64      | `koffi-3.3.3.tgz` includes C/C++/assembly/CMake sources and three MIT texts; both `@koromix/koffi-*` target archives match frozen npm SHA-512 pins. Registry metadata has no `gitHead`.                          | PE x64 / Mach-O arm64; macOS minimum 11.0, SDK 11.3. Core metadata declares N-API 8, but CMake uses `NAPI_VERSION_EXPERIMENTAL` and `REQUIRE_BASIC_FINALIZERS`. Windows exports include `napi_register_module_v1` and `node_api_module_get_api_version_v1`; exports/declarations do not prove exact ABI requirements. Exact binary build correspondence, compiler/configuration and target loading remain missing. |
| resvg 2.6.2, Windows x64 MSVC/macOS arm64 | Core and target npm archives match frozen pins. `resvg-source-9ca0584.tar.gz` is pinned to registry `gitHead` `9ca058462ac529120c8cc84ddcd6fef644cc5406`; it contains MPL text and Cargo.toml.                   | PE x64 / Mach-O arm64; macOS minimum 11.0, SDK 14.0. Source declares a cdylib, napi 2.16.0 with `serde-json`/`async`, LTO and Windows static CRT configuration. **No Cargo.lock** is present; patches include resvg revision `3495d870` and moving woff2 branch `fix-total-compressed-size`. Exact resolved sources/features, compiled contributions, ABI and addon/source correspondence remain missing.          |
| Noto Sans CJK TC 2.004                    | Unmodified `NotoSansCJKtc-Regular.otf` and `font-LICENSE` from commit `523d033d6cb47f4a80c58a35753646f5c3608a78`.                                                                                                | SFNT names identify Noto Sans CJK TC, version 2.004, © 2014–2021 Adobe and the Google Noto trademark. The retained generic OFL text has no copyright/RFN header. Stage destination `default.ttf` does not establish OTF decoding or CJK rasterization.                                                                                                                                                             |
| FFmpeg/FFprobe 7.1.1 source candidate     | `ffmpeg-source-db69d06.tar.gz`, upstream commit `db69d06eeeab4f46da15030a80d539efb4503ca8`; retained LICENSE.md, GPLv2, LGPLv2.1 and configure. Official release tar/signature requests previously returned 503. | **No target FFmpeg or FFprobe executable exists in this intake.** No binary configuration, codec inventory, toolchain, recursive imports, corresponding source/relink package or selected license conclusion exists. Source version 7.1.1 is neither a shipping choice nor a security endorsement.                                                                                                                 |

SHA-256 pins for the source inputs used above:

| Retained source record         | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `node-v24.14.0.tar.xz`         | `9fe025ef4028aba95d16e7810518bf4a5e8abfb0bdc07d8a3fdbb0afd538d77f` |
| `koffi-3.3.3.tgz`              | `c53f8da8e3c916ae8d666256650916768c7c4e8a579f188d794e8371b5773308` |
| `resvg-source-9ca0584.tar.gz`  | `7ce8697451237577d473361aa688917a48cba00c4a8f3302a833455c9c2013fa` |
| `NotoSansCJKtc-Regular.otf`    | `dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4` |
| `ffmpeg-source-db69d06.tar.gz` | `173ba614d8636491106cba08d79db469b5dee4b479388bc4fbcead8ca1fb79b1` |

The additionally inspected Node source members have SHA-256
`810833d67e6d1d33360b2e9d43f9c721ab349263920502bfcbee439fea0c326f`
(`BUILDING.md`) and
`74d05b970e49928464a4e217adaafde365f77761deb86a8deae6fe9a5b14f1d6`
(`src/node_version.h`). Koffi's `src/koffi/CMakeLists.txt` has
`ec883d8fe2ff82bc315ecf6ae951d878cd30ba462924ea5d75fc81acc321659c`.

## Signature evidence levels

Checksum matching binds bytes to the retained upstream checksum/lock record.
Embedded signature consistency additionally checks those bytes against the
embedded signing material. Neither establishes trusted publisher identity or OS
acceptance. OpenSSL 3.5.7 was used offline with `-noverify`, which deliberately
omits certificate-chain trust validation.

| Retained payload                                                                                    | Actual offline observation                                                                                                                                                                                                                                                                                                                                   | Still unverified                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows Node `node.exe`, SHA-256 `63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088` | PE certificate table contains PKCS#7. `openssl smime -verify -noverify -binary -inform DER` succeeds. Its signed SHA-256 `53d234d5dab5a6aeb7da3aef1a10cd973fa39a5aeb983896676833b73fe8be1c` matches the Authenticode PE digest, excluding checksum/security-directory fields and the certificate table. Embedded signer certificate names OpenJS Foundation. | Windows Authenticode trust policy, chain/revocation, timestamp validation and SmartScreen acceptance. The digest here is an Authenticode digest, distinct from whole-file SHA-256.   |
| macOS Node `bin/node`, SHA-256 `20a18709f0154d668f1bd6f6ea8c2a7ae001447b4b2c339732f22e57a8767a55`   | All 28,856 code-page SHA-256 slots match; CodeDirectory SHA-256 is `ce11e70b8de14c6faa257404df43bbc31a13654111c48b53c88ac377e41acdf2`. Embedded CMS verifies against that CodeDirectory using `openssl cms -verify -noverify -binary -inform DER`. Certificate names `Developer ID Application: Node.js Foundation (HX7739G8FX)`.                            | Apple chain/revocation, timestamp, designated requirements, entitlements/special-slot policy, notarization and Gatekeeper acceptance. This was not `codesign` or `spctl` validation. |
| Windows Koffi/resvg addons                                                                          | Both PE certificate-table entries are zero: no embedded Authenticode signature was observed. Their whole-file pins still match.                                                                                                                                                                                                                              | Publisher authentication and target loader acceptance; unsigned upstream addons do not constitute a signed OpenFilm package.                                                         |
| macOS Koffi/resvg addons                                                                            | CodeDirectory flags `0x20002` include ad-hoc signing; 297/858 code-page hashes match respectively. Neither signature contains a CMS signer.                                                                                                                                                                                                                  | Ad-hoc integrity has no publisher identity. Application signing, library validation policy and target loader acceptance remain separate.                                             |

Node/FFmpeg GitHub tag records say `verification.verified: true`; this is retained
upstream metadata, not independent GPG validation. No trusted release keyring or
detached archive signature is retained, so Node release SHASUMS signatures and
FFmpeg release signatures remain unverified. npm registry signature fields were
not verified against trusted registry keys. This audit acquired no keys or
credentials and does not upgrade the inventory's `signatureVerified: false`.

Static direct imports were also inspected with `objdump -p` for PE and Mach-O
load-command parsing: Windows Node names eleven system DLLs; Koffi names
KERNEL32/ADVAPI32; resvg names kernel32/ntdll/advapi32/bcrypt. macOS Node names
CoreFoundation/Security/libc++/libSystem; Koffi names libc++/libSystem; resvg names
libiconv/libSystem. These are observations, **not a reviewed system allowlist or
recursive ABI closure**. They do not replace the target-bound policy/evidence
required by [runtime staging](../native-installer.md#explicit-support-files-and-emitted-attribution).

## License-text pins and obligation checklist

These are engineering tasks derived from the retained texts, pending independent
rights review. A package's declared license or a source archive alone does not
conclude the license of every compiled contribution.

| Actual retained text              | SHA-256                                                            | Redistribution work and missing evidence                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node Windows bundled LICENSE      | `8efdacdc1cfa3460aeb7fe98e3c54337b971d5da70e6eee292b73b981acb220c` | Preserve the entire target-bundled text, including applicable MIT/BSD/Unicode notices and Apache license/NOTICE duties. Map its contributions to shipped bytes; source build-tool licenses must not be indiscriminately assigned to the executable. No independent mapping/approval exists.                                                                                                                                                  |
| Node macOS/source bundled LICENSE | `4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18` | Same review as Windows; preserve the actual target bytes despite line-ending equivalence.                                                                                                                                                                                                                                                                                                                                                    |
| Koffi MIT LICENSE.txt             | `22bcbbbacd739b026a8dc484f62a31484ce4c4e31f3408b60b29b4e41d62b290` | Carry the copyright and permission notice. Both target addon archives omit license/NOTICE files; retain the reviewed core and vendor texts during staging. MIT does not itself require a source offer or relink kit.                                                                                                                                                                                                                         |
| Koffi node-addon-api MIT text     | `89024017b88a9f2b763f79b941a4f2db3b4428edfcacdc0b23866b2da633ad0c` | Preserve this separate vendor notice; verify the compiled contribution/build correspondence.                                                                                                                                                                                                                                                                                                                                                 |
| Koffi node-api-headers MIT text   | `a553508f516031c91f3af1148d44970cb81bbae6c4f091be6835d39cc252238c` | Preserve this separate vendor notice; the three MIT pins are already required by staging.                                                                                                                                                                                                                                                                                                                                                    |
| resvg core/source MPL-2.0         | `4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1` | MPL §§3.1–3.2 require the covered source and recipient instructions for obtaining it under MPL; §3.4 preserves notices. Record exact corresponding covered source, modifications and delivery URL/package. The retained archive has no dependency license/NOTICE closure; target npm archives omit notices. Resolve actual compiled contributions, not an entire unrelated Cargo.lock list. MPL itself has no general relinking requirement. |
| Font OFL-1.1                      | `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` | Carry copyright and OFL text, preserve the font's license and observe the standalone-sale restriction. Preserve embedded Adobe copyright/Google trademark information; identify any Reserved Font Names before modification. OFL modification/name rules concern font software and do not relicense OpenFilm. No font modification is proposed.                                                                                              |
| FFmpeg LICENSE.md                 | `cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2` | Actual build configuration selects the applicable license. libx264 requires GPL; native AAC is distinct from optional libfdk_aac. `--enable-version3` changes license versions; `--enable-nonfree` makes the resulting build unredistributable and is rejected by staging. Include applicable external-codec/IJG credit/change notices. No binary/configuration exists to classify.                                                          |
| FFmpeg LGPL-2.1 text              | `b634ab5640e258563c536e658cad87080553df6f34f62269a21d554844e58bfe` | §§4/6 require applicable corresponding source and a valid combined-work relink/shared-library route where required; preserve modification/reverse-engineering rights. A chosen qualifying written offer must actually be fulfillable. Record exact source/build scripts, object/relink material or qualifying shared-library mechanism; none is supplied for a target binary.                                                                |
| FFmpeg GPL-2.0 text               | `8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643` | If selected, §3 requires complete corresponding source or a qualifying source offer with the binary, including required build/install scripts. Resolve all external code and any selected later-version terms/texts. This source snapshot does not satisfy an unknown binary's obligations.                                                                                                                                                  |

## Remaining gates and custody

| Gate                     | Evidence still required                                                                                                                                                                                                                                                 | Dependency type                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Complete reviewed inputs | Select actual target FFmpeg/FFprobe binaries and build recipe; close corresponding sources, external codecs, notices, source delivery/offer/relink obligations and addon build correspondence. Review the full shipped JS/emitted-code/font/addon contribution closure. | Supply and independent rights/build review; not inherently a physical-workstation gate.                    |
| Reviewed input transport | Complete valid RuntimeInputs and hash-pinned attribution/linkage/distribution receipts, then an independently reviewed input archive and an authorized same-repository/same-commit source artifact/run. No reviewed source upload/run is established by this dossier.   | Input/review/automation dependency. No placeholder receipts, fabricated artifact IDs or producer dispatch. |
| Target runtime           | Target-bound OS/build/architecture/ABI import policy and observations, real Windows x64/macOS arm64 staging, runtime SPDX and independently accepted manifest digest; actual owned launch/close and font/addon/tool checks.                                             | Actual target execution plus independent manifest review. Header parsing cannot supply it.                 |
| Final installer/app      | Final package identity, authorized signing/notarization, OS trust and clean-user lifecycle observations. Native shell/generated/static/sysroot/final-shell linkage remains issue 140's post-build scope.                                                                | Signing authority and platform acceptance; distinct from incomplete source/rights evidence.                |

Offline inspection used Python stdlib hashing/archive/header parsing, `objdump -p`
and the two OpenSSL commands above. Selected source members were retained outside
the repository; no source or payload code was run. The retained inspection script SHA-256 is
`8ab27d5b4784a7d1730ee78d814bc440fffef40f15f1efb45df0996f96e22430`;
its structured report SHA-256 is
`65c1087dd9c89ceec900a74df867ac4aa92071738f5cc86e8d8ca4b39b88bf24`.
These records are available with the retained inputs for review; they are not
approved license/linkage receipts, runtime manifests or public release assets.
The public record contains provenance and hash aggregates only.
