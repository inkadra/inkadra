// better-auth lists every framework and tool it integrates with as an optional peer. pnpm links
// those peers whenever the workspace has them (React, Vite, Vitest, drizzle-kit…), and they end
// up in the server's production install. Keep only the peers the server uses.
const KEEP_PEERS = { 'better-auth': ['drizzle-orm'] };

function readPackage(pkg) {
  const keep = KEEP_PEERS[pkg.name];
  if (keep && pkg.peerDependencies) {
    for (const name of Object.keys(pkg.peerDependencies)) {
      if (!keep.includes(name)) {
        delete pkg.peerDependencies[name];
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
