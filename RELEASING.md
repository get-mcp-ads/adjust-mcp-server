# Publishing releases

Releases are driven by version tags. The `release.yml` workflow publishes npm first, then the GitHub release, then the MCP Registry entry, because the registry reads `mcpName` from the published npm package.

## One-time setup

- On npmjs.com, add a trusted publisher for `@getmcpads/adjust-mcp-server` that points at this repository and the workflow file `release.yml`. No npm token is stored in the repository.
- Add the `MCP_DNS_PRIVATE_KEY` repository secret. It signs the registry login for the `getmcpads.com` domain that owns the `com.getmcpads/adjust` name.

## Each release

1. Update the version in the three files that carry it: `package.json`, `server.json` (both the top-level `version` and the npm package entry) and `PACKAGE_VERSION` in `src/server.ts`. The test suite fails when they disagree.
2. Add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`. The workflow uses that section as the release notes and stops when it is missing.
3. Run `npm run catalog` to regenerate `server-card.json`, then `npm run typecheck`, `npm run lint` and `npm test`.
4. Open a pull request and merge it after CI succeeds.
5. Tag the merge commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. The workflow checks that the tag matches `package.json`, runs the audit, typecheck, build and tests, then:
   - publishes the package to npm with provenance,
   - creates the GitHub release from the changelog section,
   - publishes `server.json` to the MCP Registry.

Every step skips cleanly when its target already holds the version, so a partial release can be completed by rerunning the workflow from the Actions tab with the existing tag.

Publishing a GitHub source release does not claim npm or MCP Registry availability. The README distinguishes source installation from package installation.

Before tagging, add the release to CHANGELOG.md as `## X.Y.Z - YYYY-MM-DD - Title`, then run `npm run release-history`. The README shows every release from the changelog, and the test suite fails when it falls behind.
