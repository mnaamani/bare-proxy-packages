# Publishing

Six packages, versioned independently, published from tags by
[`.github/workflows/release.yaml`](.github/workflows/release.yaml). A tag is
`<package-name>@<version>`, and it publishes that one package:

```
git tag barex-proxy-agent@0.1.0
git push origin barex-proxy-agent@0.1.0
```

Everything below that a machine can check, one of the checks already does. The list is
here for the parts that need a person, and so that the first release - the one where none
of this has been exercised yet - has something to follow.

## Once, before the first release

- [ ] **Claim the names.** They were free when this was written; a name is taken the moment
      someone else publishes it. `npm view <name>` answering `E404` means it is still yours
      to take.
- [ ] **Publish `barex-proxy-agent` first, by hand.** Trusted publishing cannot be
      configured for a package that does not exist yet, so the first version of the one
      package nothing else depends on goes up from a laptop, with
      `npm publish --workspace packages/barex-proxy-agent`. Everything after it can go
      through the workflow.
- [ ] **Configure trusted publishing** for each package on npmjs.com, under Settings ->
      Trusted publishers: this repository, workflow `release.yaml`. No token is stored in
      GitHub; the job proves who it is over OIDC and npm mints a short-lived one.
- [ ] **Turn on 2FA** for the npm account, if it is not on. Trusted publishing removes the
      token; it does not protect the account.

## Every release

- [ ] **Bump the version** in the package's `package.json`, and bump the ranges in any
      package that depends on it. Nothing does this automatically - the release is one
      package, but a dependency range is written in another.
- [ ] **Publish in dependency order.** `barex-proxy-agent` has no siblings above it;
      `barex-http-proxy-agent`, `barex-https-proxy-agent` and `barex-socks-proxy-agent`
      depend on it; `barex-any-proxy-agent` depends on all three. A release out of order
      leaves a package on the registry that cannot be installed, and the preflight refuses
      it for exactly that reason.
- [ ] **Read the README as a stranger.** It is the npm landing page, and the install line
      and first example are what a reader tries first.
- [ ] **Check the CHANGELOG**, if the change is one an existing user would notice.
- [ ] **`npm run lint && npm test && npm run check-packaging`** locally, so the tag is not
      the thing that discovers a failure.

## What the checks already cover

Nothing below needs doing by hand. It is written down so that a failure is legible when
one of them speaks up.

| Check                                                 | What it catches                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check-packaging`                             | Packs the real tarballs and installs them outside the workspace, then imports each under Bare. Finds a file missing from `files`, a runtime import declared as a devDependency, an `exports` map pointing at something not shipped. Runs on all four platforms in CI. |
| `node scripts/check-publishable.mjs <name> <version>` | Tag version against manifest version, a version already spent on the registry, and every sibling dependency range resolving to something published. Runs in the release workflow before anything is uploaded.                                                         |
| `npm run lint`                                        | Formatting, the ASCII check, and the declaration files agreeing with the runtime exports.                                                                                                                                                                             |
| `npm test`                                            | The test suites, on linux-x64, linux-arm64, darwin-arm64 and win32-x64.                                                                                                                                                                                               |
| `npm run examples`                                    | The examples still run. They rot faster than anything else here.                                                                                                                                                                                                      |

## Things that cannot be undone

npm allows an unpublish within 72 hours, and after that the version is spent: the number
can never be reused, even once the package is gone. A bad release is therefore fixed by
publishing the next version, not by replacing the last one. The same goes for a version
published out of order - the range that resolves to nothing stays broken for anyone who
installed it in between.
