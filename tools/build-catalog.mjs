import { constants as fsConstants, createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const ITERATIONS = 600_000;
const SYSTEMS = Object.freeze({
  snes: new Set([".sfc", ".smc", ".fig", ".swc", ".zip", ".7z", ".rar"]),
  gb: new Set([".gb", ".gbc", ".dmg", ".zip", ".7z"]),
  gba: new Set([".gba", ".zip", ".7z"]),
  arcade: new Set([".zip", ".7z"]),
});
const ASSET_PATTERN = /^assets\/[a-f0-9]+\.bin$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function usage() {
  console.error("Uso: node tools/build-catalog.mjs --system <snes|gb|gba|arcade> <pasta-das-roms> <pasta-de-saida>");
  console.error("Defina a senha somente na variável ROM_NOSTALG_PASSWORD.");
  console.error("O catálogo existente é atualizado de forma incremental; não apague a pasta de saída.");
}

function parseArguments(argumentsList) {
  let system = "";
  let reuseArgument = "";
  const positional = [];

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--system") {
      system = String(argumentsList[index + 1] || "").toLowerCase();
      index += 1;
    } else if (argument.startsWith("--system=")) {
      system = argument.slice("--system=".length).toLowerCase();
    } else if (argument === "--reuse-catalog") {
      reuseArgument = argumentsList[++index] || "";
      if (!reuseArgument || reuseArgument.startsWith("--")) throw new Error("Informe o catálogo de recuperação.");
    } else {
      positional.push(argument);
    }
  }

  if (!Object.hasOwn(SYSTEMS, system) || positional.length !== 2) {
    usage();
    throw new Error("Informe um sistema válido e exatamente duas pastas.");
  }

  return { system, inputArgument: positional[0], outputArgument: positional[1], reuseArgument };
}

function cleanTitle(fileName) {
  return basename(fileName, extname(fileName))
    .replace(/[._]+/g, " ")
    .replace(/\s*[\[(](?:U|US|USA|E|EU|EUR|J|JP|JPN|W|World|Beta|Proto|Rev[^\])]*|V\d[^\])]*)[\])]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function encryptedPayload(key, bytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

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

function encryptedEnvelope(key, salt, iterations, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);

  return {
    version: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: salt.toString("base64"),
    },
    cipher: {
      name: "AES-GCM",
      iv: iv.toString("base64"),
    },
    payload: ciphertext.toString("base64"),
  };
}

function pathIsInside(parentPath, candidatePath) {
  const candidateRelative = relative(parentPath, candidatePath);
  return candidateRelative !== ""
    && candidateRelative !== ".."
    && !candidateRelative.startsWith(`..${sep}`)
    && !isAbsolute(candidateRelative);
}

function resolveAssetPath(catalogDirectory, asset) {
  if (!ASSET_PATTERN.test(asset || "")) {
    throw new Error(`Caminho de asset inválido: ${asset}`);
  }

  const assetDirectory = resolve(catalogDirectory, "assets");
  const assetPath = resolve(catalogDirectory, ...asset.split("/"));
  if (!pathIsInside(assetDirectory, assetPath)) {
    throw new Error(`Asset fora da pasta permitida: ${asset}`);
  }
  return assetPath;
}

async function pathInfo(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validEnvelope(envelope) {
  if (envelope?.version !== 1
    || envelope.kdf?.name !== "PBKDF2"
    || envelope.kdf?.hash !== "SHA-256"
    || !Number.isInteger(envelope.kdf?.iterations)
    || envelope.kdf.iterations < 100_000
    || envelope.kdf.iterations > 1_500_000
    || envelope.cipher?.name !== "AES-GCM") {
    return false;
  }

  try {
    return Buffer.from(envelope.kdf.salt, "base64").length === 16
      && Buffer.from(envelope.cipher.iv, "base64").length === 12
      && Buffer.from(envelope.payload, "base64").length > 16;
  } catch {
    return false;
  }
}

function validExistingGame(game) {
  return typeof game?.id === "string"
    && /^[a-f0-9]+$/i.test(game.id)
    && typeof game?.title === "string"
    && game.title.trim().length > 0
    && typeof game?.fileName === "string"
    && game.fileName.length > 0
    && ASSET_PATTERN.test(game?.asset || "")
    && Number.isSafeInteger(game?.size)
    && game.size > 0
    && (game.sha256 === undefined || SHA256_PATTERN.test(game.sha256));
}

async function loadExistingCatalog(outputDirectory, password, requestedSystem) {
  const outputInfo = await pathInfo(outputDirectory);
  if (!outputInfo) return null;
  if (!outputInfo.isDirectory()) {
    throw new Error(`A saída existente não é uma pasta: ${outputDirectory}`);
  }

  const existingNames = await readdir(outputDirectory);
  if (existingNames.length === 0) return null;
  if (!existingNames.includes("catalog.json") || !existingNames.includes("assets")) {
    throw new Error(`A pasta de saída não contém um catálogo atualizável: ${outputDirectory}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(await readFile(join(outputDirectory, "catalog.json"), "utf8"));
  } catch {
    throw new Error("O catálogo existente não contém um envelope JSON válido.");
  }
  if (!validEnvelope(envelope)) {
    throw new Error("O envelope do catálogo existente é inválido.");
  }

  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const key = pbkdf2Sync(password, salt, envelope.kdf.iterations, 32, "sha256");
  let manifest;
  try {
    const manifestBytes = decryptAesGcm(
      key,
      Buffer.from(envelope.cipher.iv, "base64"),
      Buffer.from(envelope.payload, "base64"),
    );
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Senha incorreta ou catálogo existente danificado.");
  }

  if (![1, 2].includes(manifest?.version)
    || !Array.isArray(manifest.games)
    || manifest.games.length === 0
    || !manifest.games.every(validExistingGame)) {
    throw new Error("O manifesto do catálogo existente é inválido.");
  }
  if (manifest.version === 2 && manifest.system !== requestedSystem) {
    throw new Error(`O catálogo existente pertence ao sistema ${manifest.system}, não ${requestedSystem}.`);
  }

  const seenIds = new Set();
  const seenAssets = new Set();
  const games = [];
  for (const game of manifest.games) {
    const assetPath = resolveAssetPath(outputDirectory, game.asset);
    if (seenIds.has(game.id) || seenAssets.has(assetPath)) {
      throw new Error(`ID ou asset duplicado no catálogo existente: ${game.title}`);
    }
    const assetInfo = await pathInfo(assetPath);
    if (!assetInfo?.isFile()) {
      throw new Error(`Asset ausente no catálogo existente: ${game.asset}`);
    }

    let contentHash = game.sha256?.toLowerCase() || "";
    if (!contentHash) {
      const encrypted = await readFile(assetPath);
      let clearBytes;
      try {
        clearBytes = decryptAesGcm(key, encrypted.subarray(0, 12), encrypted.subarray(12));
      } catch {
        throw new Error(`Não foi possível validar o asset legado: ${game.title}`);
      }
      if (clearBytes.length !== game.size) {
        throw new Error(`Tamanho divergente no asset legado: ${game.title}`);
      }
      contentHash = sha256(clearBytes);
    }

    games.push({ ...game, sha256: contentHash, assetPath });
    seenIds.add(game.id);
    seenAssets.add(assetPath);
  }

  const assetFiles = (await readdir(join(outputDirectory, "assets"), { withFileTypes: true }))
    .filter((entry) => entry.isFile());
  if (assetFiles.length !== games.length) {
    throw new Error("O catálogo existente contém assets órfãos ou ausentes; execute a verificação antes de atualizar.");
  }

  return {
    games,
    key,
    iterations: envelope.kdf.iterations,
    manifest,
    salt,
  };
}

async function sourceGames(inputDirectory, extensions) {
  const metadataPath = join(inputDirectory, ".catalog-metadata.json");
  const metadata = await pathInfo(metadataPath)
    ? JSON.parse(await readFile(metadataPath, "utf8")) : null;
  if (metadata && (metadata.version !== 1 || !metadata.games || Array.isArray(metadata.games))) {
    throw new Error("Metadados de versões inválidos.");
  }
  const fileNames = (await readdir(inputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }));

  if (fileNames.length === 0) {
    throw new Error("Nenhuma ROM compatível foi encontrada na pasta de entrada.");
  }

  const games = [];
  const groups = new Map();
  for (const fileName of fileNames) {
    const filePath = join(inputDirectory, fileName);
    const fileInfo = await stat(filePath);
    if (fileInfo.size <= 0) {
      throw new Error(`A ROM está vazia: ${fileName}`);
    }
    const details = metadata?.games[fileName];
    if (metadata) {
      if (!details || !/^[a-z0-9-]+$/.test(details.groupId || "")
        || !["original", "pt-BR"].includes(details.variant)
        || typeof details.displayTitle !== "string" || !details.displayTitle.trim()) {
        throw new Error(`Metadados ausentes ou inválidos: ${fileName}`);
      }
      const group = groups.get(details.groupId) || { title: details.displayTitle, variants: new Set() };
      if (group.title !== details.displayTitle || group.variants.has(details.variant)) {
        throw new Error(`Grupo com título divergente ou versão duplicada: ${details.groupId}`);
      }
      group.variants.add(details.variant);
      groups.set(details.groupId, group);
    }
    games.push({
      fileName,
      filePath,
      sha256: await sha256File(filePath),
      size: fileInfo.size,
      title: cleanTitle(fileName) || fileName,
      ...(details ? { groupId: details.groupId, variant: details.variant, displayTitle: details.displayTitle } : {}),
    });
  }
  if (metadata && Object.keys(metadata.games).some((name) => !fileNames.includes(name))) {
    throw new Error("Metadados contêm arquivos ausentes da pasta-fonte.");
  }
  return games;
}

function queueBy(items, keyOf) {
  const queues = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(item);
  }
  return queues;
}

function firstUnused(queue, usedAssets) {
  return (queue || []).find((candidate) => !usedAssets.has(candidate.asset)) || null;
}

function planCatalog(sources, existing, recovery) {
  const oldGames = existing?.games || [];
  const byName = queueBy(oldGames, (game) => game.fileName.toLocaleLowerCase("pt-BR"));
  const byHash = queueBy(oldGames, (game) => game.sha256);
  const recoveryByHash = queueBy(recovery?.games || [], (game) => game.sha256);
  const usedAssets = new Set();
  const plans = [];
  const counts = { added: 0, modified: 0, removed: 0, renamed: 0, reused: 0, restored: 0 };

  for (const source of sources) {
    let previous = firstUnused(byName.get(source.fileName.toLocaleLowerCase("pt-BR")), usedAssets);
    let kind;
    if (previous) {
      kind = previous.sha256 === source.sha256 ? "reused" : "modified";
    } else {
      previous = firstUnused(byHash.get(source.sha256), usedAssets);
      kind = previous ? "renamed" : "added";
    }

    if (!previous) {
      const candidate = (recoveryByHash.get(source.sha256) || []).find((game) => (
        !usedAssets.has(game.asset) && !oldGames.some((old) => old.id === game.id || old.asset === game.asset)
      ));
      if (candidate) { previous = candidate; kind = "restored"; }
    }

    // Keep variant identity on later incremental runs even without a sidecar.
    for (const field of ["groupId", "variant", "displayTitle"]) {
      if (source[field] === undefined && previous?.[field] !== undefined) source[field] = previous[field];
    }

    if (previous) usedAssets.add(previous.asset);
    counts[kind] += 1;
    plans.push({ kind, previous, source });
  }

  counts.removed = oldGames.filter((game) => !usedAssets.has(game.asset)).length;
  const metadataChanged = plans.some(({ kind, previous, source }) => (
    kind === "reused" && ["title", "groupId", "variant", "displayTitle"].some((field) => previous[field] !== source[field])
  ));
  const schemaUpgrade = Boolean(existing) && (
    existing.manifest.version !== 2
    || typeof existing.manifest.system !== "string"
    || existing.games.some((game) => !SHA256_PATTERN.test(game.sha256))
  );

  return {
    counts,
    hasChanges: !existing
      || schemaUpgrade
      || metadataChanged
      || counts.added > 0
      || counts.restored > 0
      || counts.modified > 0
      || counts.removed > 0
      || counts.renamed > 0,
    plans,
    schemaUpgrade,
  };
}

function uniqueAsset(existingNames) {
  let assetName;
  do {
    assetName = `${randomBytes(18).toString("hex")}.bin`;
  } while (existingNames.has(assetName));
  existingNames.add(assetName);
  return assetName;
}

async function replaceOutputDirectory(outputDirectory, stagingDirectory) {
  const outputInfo = await pathInfo(outputDirectory);
  if (!outputInfo) {
    await rename(stagingDirectory, outputDirectory);
    return;
  }

  const backupDirectory = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.backup-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  await rename(outputDirectory, backupDirectory);
  try {
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    await rename(backupDirectory, outputDirectory);
    throw error;
  }
  await rm(backupDirectory, { force: true, recursive: true });
}

async function writeCatalog(outputDirectory, system, existing, plan, password) {
  const stagingDirectory = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.build-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  const stagingAssets = join(stagingDirectory, "assets");
  const salt = existing?.salt || randomBytes(16);
  const iterations = existing?.iterations || ITERATIONS;
  const key = existing?.key || pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const usedAssetNames = new Set(plan.plans.filter((item) => item.previous).map((item) => basename(item.previous.asset)));

  await mkdir(stagingAssets, { recursive: true });
  try {
    const games = [];
    for (const [index, item] of plan.plans.entries()) {
      const { kind, previous, source } = item;
      const id = previous?.id || randomBytes(12).toString("hex");
      const assetName = previous ? basename(previous.asset) : uniqueAsset(usedAssetNames);
      const asset = `assets/${assetName}`;
      const targetAssetPath = join(stagingAssets, assetName);

      if (["reused", "renamed", "restored"].includes(kind)) {
        if (kind === "restored") {
          const encrypted = await readFile(previous.assetPath);
          const clear = decryptAesGcm(key, encrypted.subarray(0, 12), encrypted.subarray(12));
          if (clear.length !== source.size || sha256(clear) !== source.sha256) {
            throw new Error(`Asset de recuperação divergente: ${source.fileName}`);
          }
        }
        await copyFile(previous.assetPath, targetAssetPath, fsConstants.COPYFILE_EXCL);
      } else {
        const clearBytes = await readFile(source.filePath);
        const encrypted = encryptedPayload(key, clearBytes);
        await writeFile(targetAssetPath, encrypted, { flag: "wx" });
      }

      games.push({
        id,
        title: source.title || `Jogo ${index + 1}`,
        fileName: source.fileName,
        asset,
        size: source.size,
        sha256: source.sha256,
        ...(source.groupId ? { groupId: source.groupId, variant: source.variant, displayTitle: source.displayTitle } : {}),
      });
    }

    games.sort((left, right) => left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" }));
    const manifest = Buffer.from(JSON.stringify({
      version: 2,
      system,
      generatedAt: new Date().toISOString(),
      games,
    }));
    const envelope = encryptedEnvelope(key, salt, iterations, manifest);
    await writeFile(join(stagingDirectory, "catalog.json"), `${JSON.stringify(envelope)}\n`, { flag: "wx" });
    await replaceOutputDirectory(outputDirectory, stagingDirectory);
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function main() {
  const { system, inputArgument, outputArgument, reuseArgument } = parseArguments(process.argv.slice(2));
  const password = process.env.ROM_NOSTALG_PASSWORD || "";
  if (password.length < 16) {
    throw new Error("Use uma senha forte com pelo menos 16 caracteres.");
  }

  const inputDirectory = resolve(inputArgument);
  const outputDirectory = resolve(outputArgument);
  const inputInfo = await stat(inputDirectory);
  if (!inputInfo.isDirectory()) {
    throw new Error(`A entrada não é uma pasta: ${inputDirectory}`);
  }
  if (dirname(outputDirectory) === outputDirectory
    || inputDirectory === outputDirectory
    || pathIsInside(inputDirectory, outputDirectory)
    || pathIsInside(outputDirectory, inputDirectory)) {
    throw new Error("As pastas de entrada e saída precisam ser separadas e nenhuma pode conter a outra.");
  }
  await mkdir(dirname(outputDirectory), { recursive: true });

  const existing = await loadExistingCatalog(outputDirectory, password, system);
  const recovery = reuseArgument ? await loadExistingCatalog(resolve(reuseArgument), password, system) : null;
  if (reuseArgument && (!existing || !recovery || !existing.key.equals(recovery.key))) {
    throw new Error("A recuperação exige catálogos com a mesma chave derivada (senha, salt e iterações).");
  }
  const sources = await sourceGames(inputDirectory, SYSTEMS[system]);
  const plan = planCatalog(sources, existing, recovery);
  if (!plan.hasChanges) {
    console.log(`Catálogo ${system} já está atualizado: ${sources.length} jogos, nenhum arquivo alterado.`);
    return;
  }

  await writeCatalog(outputDirectory, system, existing, plan, password);
  const { added, modified, removed, renamed, reused, restored } = plan.counts;
  console.log(
    `Catálogo ${system} atualizado: ${sources.length} jogos; `
    + `${added} novos, ${modified} alterados, ${renamed} renomeados, ${removed} removidos, ${reused} preservados e ${restored} recuperados sem recifrar.`,
  );
  if (plan.schemaUpgrade) {
    console.log("Manifesto legado migrado para o formato incremental; os assets inalterados foram preservados.");
  }
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
