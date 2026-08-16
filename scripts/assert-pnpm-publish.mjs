#!/usr/bin/env node
//
// Refuse `npm publish` in this workspace.
//
// pnpm rewrites the `workspace:*` protocol to a concrete version when it packs;
// npm does not. Publishing with npm therefore ships manifests carrying
// `"@plandesk/db": "workspace:*"`, and every install of that version dies with
// `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`.
//
// This is not hypothetical: 2.3.0 shipped that way across api, mcp and cli and
// had to be deprecated and reissued as 2.3.1. npm will not let a burned version
// number be reused, so the mistake costs a release, not just a retry.
//
// Wired as `prepublishOnly`, which both npm and pnpm run before packing.
const agent = process.env.npm_config_user_agent ?? '';

if (!agent.startsWith('pnpm')) {
  console.error(
    [
      '',
      '  ✖ Refusing to publish: this workspace must be published with pnpm.',
      '',
      `    detected packager: ${agent || '(none — npm_config_user_agent unset)'}`,
      '',
      "    npm leaves pnpm's `workspace:*` protocol in the packed manifest, so the",
      '    published version is uninstallable (EUNSUPPORTEDPROTOCOL). A burned',
      '    version number cannot be reused.',
      '',
      '    Use:  pnpm publish --access public',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
