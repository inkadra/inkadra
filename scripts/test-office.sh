#!/usr/bin/env bash
# Converts one Word document in the -office image as the Office worker of
# deploy/compose.office.yaml would: uid 1000, no capabilities, no-new-privileges, Docker's
# seccomp profile plus the namespace calls (deploy/office-seccomp.json), read-only root. The
# conversion is the server's own convertOffice, bundled from apps/server/src: the bubblewrap
# sandbox, its filter and its limits. Fails unless a PDF with the document's text comes out.
#
#   scripts/test-office.sh
#
# Needs Docker, python3 and the workspace's dependencies (pnpm install). The image is ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}-office.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
image="${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}-office"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The smallest Word document LibreOffice opens: three parts in a zip.
python3 - "$work/check.docx" <<'PY'
import sys, zipfile
w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
parts = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{w}"><w:body><w:p><w:r><w:t>Inkadra office sandbox check</w:t></w:r></w:p></w:body></w:document>',
}
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
PY
chmod 644 "$work/check.docx"

# The server's convertOffice, bundled like apps/server/build.mjs: npm packages stay external and
# come from the image's /app/node_modules.
(cd "$root/apps/server" && node --input-type=module -e '
  import { build } from "esbuild";
  await build({
    stdin: { contents: `export { convertOffice } from "./src/media/office.ts";`, resolveDir: ".", loader: "ts" },
    outfile: process.argv[1],
    bundle: true,
    platform: "node",
    target: "node26",
    format: "esm",
    logLevel: "warning",
    plugins: [{
      name: "externalize-npm",
      setup: (b) => b.onResolve({ filter: /^[^./]/ }, (args) =>
        args.path.startsWith("@inkadra/") ? undefined : { path: args.path, external: true }),
    }],
  });
' "$work/office.mjs")
chmod 644 "$work/office.mjs"

# Where Docker applies AppArmor (Ubuntu, GitHub's runners), the two lines office.md tells such a
# host to uncomment in deploy/compose.office.yaml.
apparmor=()
if docker info --format '{{json .SecurityOptions}}' | grep -q 'name=apparmor'; then
  apparmor=(--security-opt apparmor=unconfined --security-opt systempaths=unconfined)
  echo "Docker applies AppArmor here: apparmor=unconfined and systempaths=unconfined, as office.md says"
fi

# Ubuntu 23.10+ takes every capability away inside the user namespaces of unconfined processes
# when this is 1, unless an AppArmor profile allows them: Ubuntu's bwrap-userns-restrict profile
# does, for the /usr/bin/bwrap a program of this container starts (not for one Docker starts as
# the entrypoint). Without it bubblewrap stops at
# "loopback: Failed RTM_NEWADDR: Operation not permitted". Shown for the log.
echo "kernel.apparmor_restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo absent)," \
  "/etc/apparmor.d/bwrap-userns-restrict $([ -e /etc/apparmor.d/bwrap-userns-restrict ] && echo present || echo absent)"

worker=(--user 1000:1000 --cap-drop ALL
  --security-opt no-new-privileges:true
  --security-opt "seccomp=$root/deploy/office-seccomp.json" "${apparmor[@]}"
  --read-only --tmpfs /tmp --tmpfs /data:uid=1000,gid=1000)

# office.md's sandbox check, with the same bwrap command.
docker run --rm "${worker[@]}" --entrypoint sh "$image" -c \
  'bwrap --unshare-all --unshare-user \
    --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --proc /proc --dev /dev /usr/bin/true'
echo "ok   office.md's sandbox check"

docker run --rm "${worker[@]}" \
  -e OFFICE_PREVIEWS=true \
  -v "$work/office.mjs:/app/check/office.mjs:ro" \
  -v "$work/check.docx:/fixture/check.docx:ro" \
  --entrypoint node "$image" --input-type=module -e '
    import { execFileSync } from "node:child_process";
    import { mkdir, mkdtemp } from "node:fs/promises";
    const { convertOffice } = await import("/app/check/office.mjs");
    await mkdir("/data/tmp", { recursive: true });
    const pdf = await convertOffice("/fixture/check.docx", await mkdtemp("/data/tmp/office-"), "docx");
    if (!pdf) throw new Error("conversion is off: no sandbox, filter or LibreOffice in this image");
    const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
    const text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
    console.log(info.trim());
    if (!/^Pages:\s+1$/m.test(info) || !text.includes("Inkadra office sandbox check"))
      throw new Error(`not the document: ${JSON.stringify(text)}`);
    console.log("ok   Word document converted to PDF in the sandbox");
  '
