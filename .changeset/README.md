# Changesets

The six public packages form one product and release at the same version. The
private `@oallet/config` package and test fixtures are not published.

```bash
pnpm changeset # write an entry here and commit it with the change
```

Write summaries for package consumers. Entries remain here until they reach
`main`, where the release workflow opens a version PR. Merging that PR publishes
all five packages to npm with the `latest` tag.

`release.yaml` is prepared for npm trusted publishing. Configure it as the
trusted publisher for each package after its first publish. Initially unpublished
`@oallet/*` packages can be bootstrapped with a granular `NPM_TOKEN`
repository secret; remove that secret after every package uses OIDC.

Full documentation: https://github.com/changesets/changesets
