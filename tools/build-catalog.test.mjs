import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const buildScript = fileURLToPath(new URL("./build-catalog.mjs", import.meta.url));
const verifyScript = fileURLToPath(new URL("./verify-catalog.mjs", import.meta.url));
const password = "senha-de-teste-bem-forte";

function decryptAesGcm(key, iv, sealed) {
  const ciphertext = sealed.subarray(0, -16);
  const authTag = sealed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encryptAesGcm(key, bytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    iv,
    sealed: Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]),
  };
}

async function runCatalog(inputDirectory, outputDirectory, overridePassword = password, extraArguments = []) {
  return execFileAsync(
    process.execPath,
    [buildScript, "--system", "snes", ...extraArguments, inputDirectory, outputDirectory],
    { env: { ...process.env, ROM_NOSTALG_PASSWORD: overridePassword } },
  );
}

async function snapshotCatalog(outputDirectory) {
  const catalogText = await readFile(join(outputDirectory, "catalog.json"), "utf8");
  const envelope = JSON.parse(catalogText);
  const key = pbkdf2Sync(
    password,
    Buffer.from(envelope.kdf.salt, "base64"),
    envelope.kdf.iterations,
    32,
    "sha256",
  );
  const manifestBytes = decryptAesGcm(
    key,
    Buffer.from(envelope.cipher.iv, "base64"),
    Buffer.from(envelope.payload, "base64"),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const assetDigests = new Map();
  for (const assetName of await readdir(join(outputDirectory, "assets"))) {
    assetDigests.set(assetName, digest(await readFile(join(outputDirectory, "assets", assetName))));
  }
  return { assetDigests, catalogText, envelope, key, manifest };
}

function gameByName(snapshot, fileName) {
  return snapshot.manifest.games.find((game) => game.fileName === fileName);
}

async function downgradeToLegacyManifest(outputDirectory, snapshot) {
  const legacyManifest = {
    version: 1,
    generatedAt: snapshot.manifest.generatedAt,
    games: snapshot.manifest.games.map(({ sha256: _sha256, ...game }) => game),
  };
  const encrypted = encryptAesGcm(snapshot.key, Buffer.from(JSON.stringify(legacyManifest)));
  const envelope = {
    ...snapshot.envelope,
    cipher: { name: "AES-GCM", iv: encrypted.iv.toString("base64") },
    payload: encrypted.sealed.toString("base64"),
  };
  await writeFile(join(outputDirectory, "catalog.json"), `${JSON.stringify(envelope)}\n`);
}

test("updates encrypted catalogs incrementally and preserves unchanged assets", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rom-nostalg-catalog-"));
  const inputDirectory = join(temporaryRoot, "source");
  const outputDirectory = join(temporaryRoot, "vault", "snes");

  try {
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(join(inputDirectory, "Alpha.smc"), "alpha-v1");
    await writeFile(join(inputDirectory, "Beta.sfc"), "beta-v1");

    const initialRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(initialRun.stdout, /2 novos/);
    const initial = await snapshotCatalog(outputDirectory);
    assert.equal(initial.manifest.version, 2);
    assert.equal(initial.manifest.system, "snes");
    assert.equal(initial.manifest.games.length, 2);

    await downgradeToLegacyManifest(outputDirectory, initial);
    const migrationRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(migrationRun.stdout, /Manifesto legado migrado/);
    const migrated = await snapshotCatalog(outputDirectory);
    assert.equal(migrated.manifest.version, 2);
    assert.deepEqual(migrated.assetDigests, initial.assetDigests);
    for (const fileName of ["Alpha.smc", "Beta.sfc"]) {
      assert.equal(gameByName(migrated, fileName).id, gameByName(initial, fileName).id);
      assert.equal(gameByName(migrated, fileName).asset, gameByName(initial, fileName).asset);
    }

    const unchangedRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(unchangedRun.stdout, /nenhum arquivo alterado/);
    const unchanged = await snapshotCatalog(outputDirectory);
    assert.equal(unchanged.catalogText, migrated.catalogText);
    assert.deepEqual(unchanged.assetDigests, migrated.assetDigests);

    await writeFile(join(inputDirectory, "Gamma.sfc"), "gamma-v1");
    const addedRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(addedRun.stdout, /1 novos/);
    const added = await snapshotCatalog(outputDirectory);
    for (const fileName of ["Alpha.smc", "Beta.sfc"]) {
      const before = gameByName(migrated, fileName);
      const after = gameByName(added, fileName);
      assert.equal(after.id, before.id);
      assert.equal(after.asset, before.asset);
      assert.equal(added.assetDigests.get(after.asset.slice("assets/".length)), migrated.assetDigests.get(before.asset.slice("assets/".length)));
    }

    const betaBeforeRename = gameByName(added, "Beta.sfc");
    await rename(join(inputDirectory, "Beta.sfc"), join(inputDirectory, "Beta Renamed.sfc"));
    const renamedRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(renamedRun.stdout, /1 renomeados/);
    const renamed = await snapshotCatalog(outputDirectory);
    const betaAfterRename = gameByName(renamed, "Beta Renamed.sfc");
    assert.equal(betaAfterRename.id, betaBeforeRename.id);
    assert.equal(betaAfterRename.asset, betaBeforeRename.asset);

    const alphaBeforeChange = gameByName(renamed, "Alpha.smc");
    const alphaCipherBefore = renamed.assetDigests.get(alphaBeforeChange.asset.slice("assets/".length));
    await writeFile(join(inputDirectory, "Alpha.smc"), "alpha-v2");
    const modifiedRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(modifiedRun.stdout, /1 alterados/);
    const modified = await snapshotCatalog(outputDirectory);
    const alphaAfterChange = gameByName(modified, "Alpha.smc");
    assert.equal(alphaAfterChange.id, alphaBeforeChange.id);
    assert.equal(alphaAfterChange.asset, alphaBeforeChange.asset);
    assert.notEqual(modified.assetDigests.get(alphaAfterChange.asset.slice("assets/".length)), alphaCipherBefore);

    const beforeWrongPassword = await snapshotCatalog(outputDirectory);
    await writeFile(join(inputDirectory, "Delta.sfc"), "delta-v1");
    await assert.rejects(runCatalog(inputDirectory, outputDirectory, "outra-senha-forte-de-teste"));
    const afterWrongPassword = await snapshotCatalog(outputDirectory);
    assert.equal(afterWrongPassword.catalogText, beforeWrongPassword.catalogText);
    assert.deepEqual(afterWrongPassword.assetDigests, beforeWrongPassword.assetDigests);

    await rm(join(inputDirectory, "Delta.sfc"));
    await rm(join(inputDirectory, "Beta Renamed.sfc"));
    const removedRun = await runCatalog(inputDirectory, outputDirectory);
    assert.match(removedRun.stdout, /1 removidos/);
    const removed = await snapshotCatalog(outputDirectory);
    assert.equal(removed.manifest.games.length, 2);
    assert.equal(removed.assetDigests.size, 2);

    const verification = await execFileAsync(process.execPath, [verifyScript, outputDirectory], {
      env: { ...process.env, ROM_NOSTALG_PASSWORD: password },
    });
    assert.match(verification.stdout, /Catálogo snes íntegro: 2 jogos verificados/);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("recovers legacy ciphertext with version metadata, rejects unsafe recovery, and stays idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "rom-variants-"));
  const source = join(root, "source");
  const vault = join(root, "vault");
  const backup = join(root, "backup");
  try {
    await mkdir(source);
    await writeFile(join(source, "World.smc"), "original-world");
    await writeFile(join(source, "Kart.smc"), "broken-kart");
    await runCatalog(source, vault);
    const before = await snapshotCatalog(vault);
    await cp(vault, backup, { recursive: true });
    await downgradeToLegacyManifest(backup, before);
    await rm(join(source, "World.smc"));
    await writeFile(join(source, "World PT.smc"), "translated-world");
    await runCatalog(source, vault);
    const translated = await snapshotCatalog(vault);
    await writeFile(join(source, "World.smc"), "original-world");
    await rm(join(source, "Kart.smc"));
    await writeFile(join(source, "Hack PT.smc"), "hack-2025");
    const metadata = { version: 1, games: {
      "World.smc": { groupId: "world", displayTitle: "World", variant: "original" },
      "World PT.smc": { groupId: "world", displayTitle: "World", variant: "pt-BR" },
      "Hack PT.smc": { groupId: "world-hack-2025", displayTitle: "World Hack 2025", variant: "pt-BR" },
    } };
    const sidecar = join(source, ".catalog-metadata.json");
    await writeFile(sidecar, JSON.stringify(metadata));
    const args = ["--reuse-catalog", backup];
    await assert.rejects(runCatalog(source, vault, "wrong-password-123456", args));
    assert.equal((await snapshotCatalog(vault)).catalogText, translated.catalogText);
    const run = await runCatalog(source, vault, password, args);
    assert.match(run.stdout, /1 recuperados sem recifrar/);
    const restored = await snapshotCatalog(vault);
    for (const [name, snapshot] of [["World.smc", before], ["World PT.smc", translated]]) {
      const game = gameByName(restored, name);
      const old = gameByName(snapshot, name);
      assert.equal(game.id, old.id);
      assert.equal(game.asset, old.asset);
      assert.equal(restored.assetDigests.get(game.asset.slice(7)), snapshot.assetDigests.get(old.asset.slice(7)));
      assert.equal(game.groupId, "world");
    }
    assert.equal(restored.manifest.games.length, 3);
    assert.equal(gameByName(restored, "Kart.smc"), undefined);
    assert.equal(gameByName(restored, "Hack PT.smc").groupId, "world-hack-2025");
    await runCatalog(source, vault, password, args);
    assert.equal((await snapshotCatalog(vault)).catalogText, restored.catalogText);
    metadata.games["World PT.smc"].variant = "original";
    await writeFile(sidecar, JSON.stringify(metadata));
    await assert.rejects(runCatalog(source, vault), /versão duplicada/);
    assert.equal((await snapshotCatalog(vault)).catalogText, restored.catalogText);
    metadata.games["World PT.smc"].variant = "pt-BR";
    await writeFile(sidecar, JSON.stringify(metadata));
    const otherVault = join(root, "different-salt");
    await runCatalog(source, otherVault);
    await assert.rejects(runCatalog(source, vault, password, ["--reuse-catalog", otherVault]), /mesma chave derivada/);
    assert.equal((await snapshotCatalog(vault)).catalogText, restored.catalogText);
    await execFileAsync(process.execPath, [verifyScript, vault], { env: { ...process.env, ROM_NOSTALG_PASSWORD: password } });
    // Metadata-only updates preserve ROM bytes; later runs without a sidecar keep grouping.
    metadata.games["Hack PT.smc"].displayTitle = "World Hack 2025 Revised Title";
    await writeFile(sidecar, JSON.stringify(metadata));
    await runCatalog(source, vault);
    const renamed = await snapshotCatalog(vault);
    assert.deepEqual(renamed.assetDigests, restored.assetDigests);
    await rm(sidecar);
    await runCatalog(source, vault);
    assert.equal((await snapshotCatalog(vault)).catalogText, renamed.catalogText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
