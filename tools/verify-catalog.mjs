import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
const { groupGames } = createRequire(import.meta.url)("../site/catalog-model.js");

function decryptAesGcm(key, iv, sealed) {
  if (sealed.length <= 16) {
    throw new Error("Conteúdo criptografado incompleto.");
  }

  const ciphertext = sealed.subarray(0, -16);
  const authTag = sealed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function main() {
  const [, , catalogArgument] = process.argv;
  const password = process.env.ROM_NOSTALG_PASSWORD || "";

  if (!catalogArgument || !password) {
    throw new Error("Informe a pasta do catálogo e ROM_NOSTALG_PASSWORD.");
  }

  const catalogDirectory = resolve(catalogArgument);
  const assetDirectory = resolve(catalogDirectory, "assets");
  const envelope = JSON.parse(await readFile(join(catalogDirectory, "catalog.json"), "utf8"));
  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const key = pbkdf2Sync(password, salt, envelope.kdf.iterations, 32, "sha256");
  const manifestBytes = decryptAesGcm(
    key,
    Buffer.from(envelope.cipher.iv, "base64"),
    Buffer.from(envelope.payload, "base64"),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));

  if (![1, 2].includes(manifest?.version)
    || (manifest.version === 2 && !["snes", "gb", "gba", "arcade"].includes(manifest.system))
    || !Array.isArray(manifest.games)
    || manifest.games.length === 0) {
    throw new Error("Manifesto sem jogos.");
  }

  const seenAssets = new Set();
  const seenIds = new Set();
  groupGames(manifest.games);
  for (const game of manifest.games) {
    if (typeof game.id !== "string" || seenIds.has(game.id)) throw new Error("ID ausente ou duplicado no catálogo.");
    seenIds.add(game.id);
    const assetPath = resolve(catalogDirectory, game.asset);
    const assetRelative = relative(assetDirectory, assetPath);
    const assetIsOutside = assetRelative === ".."
      || assetRelative.startsWith(`..${sep}`)
      || assetRelative === ""
      || assetRelative.includes(sep);

    if (assetIsOutside || seenAssets.has(assetPath)) {
      throw new Error(`Caminho de asset inválido ou duplicado: ${game.asset}`);
    }

    const encrypted = await readFile(assetPath);
    const clearBytes = decryptAesGcm(key, encrypted.subarray(0, 12), encrypted.subarray(12));
    if (clearBytes.length !== game.size) {
      throw new Error(`Tamanho divergente: ${game.title}`);
    }
    if (manifest.version === 2) {
      const contentHash = createHash("sha256").update(clearBytes).digest("hex");
      if (!/^[a-f0-9]{64}$/i.test(game.sha256 || "") || contentHash !== game.sha256.toLowerCase()) {
        throw new Error(`Hash divergente: ${game.title}`);
      }
    }
    seenAssets.add(assetPath);
  }

  const assetFiles = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile());
  if (assetFiles.length !== manifest.games.length) {
    throw new Error("A quantidade de assets não corresponde ao manifesto.");
  }

  const system = manifest.system || "legado";
  console.log(`Catálogo ${system} íntegro: ${manifest.games.length} jogos verificados.`);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
