"use strict";

const EMULATOR_VERSION = "4.2.3";
const EMULATOR_DATA_URL = `https://cdn.emulatorjs.org/${EMULATOR_VERSION}/data/`;
const SUPPORTED_EXTENSIONS = new Set(["sfc", "smc", "fig", "swc", "zip", "7z", "rar"]);
const CATALOG_SYSTEM = "snes";
const CATALOG_URL = new URL(`./vault/${CATALOG_SYSTEM}/catalog.json`, window.location.href);
const CATALOG_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const SAVED_PASSWORD_KEY = "rom-nostalg.catalog-password.v1";
const ACTIVE_CATALOG_PASSWORD_KEY = "rom-nostalg.active-catalog-password.v1";
const REOPEN_CATALOG_KEY = "rom-nostalg.reopen-catalog.v1";
const CATALOG_TITLE_OVERRIDES = Object.freeze({
  "Actraiser 2": "ActRaiser 2",
  "aladdin": "Disney's Aladdin",
  "Art Of Fighting": "Art of Fighting",
  "Art Of Fighting 2": "Art of Fighting 2",
  "Battletoads And Double Dragons": "Battletoads & Double Dragon",
  "Battletoads In Battlemaniacs": "Battletoads in Battlemaniacs",
  "Biker Mice From Mars": "Biker Mice from Mars",
  "Black Thorne": "Blackthorne",
  "breath of fire": "Breath of Fire",
  "Chavez": "Chávez",
  "chavez ii": "Chávez II",
  "Clock Tower (PT-BR) - [snes-forever blogspot com]": "Clock Tower (PT-BR)",
  "Contra3 The Alien War": "Contra III: The Alien Wars",
  "Daffy Duck Marv Miss": "Daffy Duck: The Marvin Missions",
  "Demon'S Crest": "Demon's Crest",
  "Donkey Kong 3 - Dixie Kong's Double Trouble": "Donkey Kong Country 3: Dixie Kong's Double Trouble!",
  "doom": "Doom",
  "Dragon Ball Z Superbutouden": "Dragon Ball Z: Super Butōden",
  "Dragon Ball Z Superbutouden 2": "Dragon Ball Z: Super Butōden 2",
  "Dragon Ball Z Superbutouden 3": "Dragon Ball Z: Super Butōden 3",
  "Dragonquest 1 & 2": "Dragon Quest I & II",
  "Dragonquest 3": "Dragon Quest III",
  "Dragonquest 5": "Dragon Quest V",
  "Dragonquest 6": "Dragon Quest VI",
  "Earth Bound": "EarthBound",
  "fatal fury special": "Fatal Fury Special",
  "Final Fantasy 2": "Final Fantasy II",
  "Final Fantasy 3 (BR)": "Final Fantasy III (PT-BR)",
  "Final Fantasy 5 PTbr": "Final Fantasy V (PT-BR)",
  "Front Mission Series - Gun Hazard": "Front Mission Series: Gun Hazard",
  "Front Mission(PTBR": "Front Mission (PT-BR)",
  "Gundam Wing - Endless Duel PTBR": "Gundam Wing: Endless Duel (PT-BR)",
  "Gundam Wing - Endless Duel": "Gundam Wing: Endless Duel",
  "Hamelin no Violin Hiki (BR)": "Hamelin no Violin Hiki (PT-BR)",
  "Illusion Of Gaia (Ingles)": "Illusion of Gaia (English)",
  "International (escalaçoes 94)": "International (Escalações 94)",
  "International SuperStar Soccer 2007 (Criado por Teg Brasil Remakes)": "International Superstar Soccer 2007 (Teg Brasil Remakes)",
  "Kirby Super Star [!]": "Kirby Super Star",
  "Kirby'S Avalanche": "Kirby's Avalanche",
  "Kirby'S Dream Course": "Kirby's Dream Course",
  "King Of Dragons": "The King of Dragons",
  "knights of the round": "Knights of the Round",
  "Lufia 2": "Lufia II: Rise of the Sinistrals",
  "Marvel Super Heroes": "Marvel Super Heroes: War of the Gems",
  "Mega Man 7 (BR)": "Mega Man 7 (PT-BR)",
  "Mega Man X (Br)": "Mega Man X (PT-BR)",
  "Mickey The Magical Quest": "The Magical Quest Starring Mickey Mouse",
  "Mickey to Donald - Magical Adventure 3 (PTBR)": "Mickey to Donald no Magical Adventure 3 (PT-BR)",
  "Mortal Kombat (Blood Patch Hack)": "Mortal Kombat (Blood Patch)",
  "Nba Jam": "NBA Jam",
  "Nba Live 97": "NBA Live 97",
  "Parodius": "Parodius Da!",
  "Parodius 2": "Gokujō Parodius",
  "pirates of dark water, the": "The Pirates of Dark Water",
  "Power Rangers Movie": "Mighty Morphin Power Rangers: The Movie",
  "rock n roll racing": "Rock n' Roll Racing",
  "ROCKFORT": "Rockfort",
  "Rockman & Forte ptbr": "Rockman & Forte (PT-BR)",
  "Rocky Rodent [h1]": "Rocky Rodent",
  "Romancing Saga": "Romancing SaGa",
  "Romancing Saga 2": "Romancing SaGa 2",
  "Romancing Saga 3": "Romancing SaGa 3",
  "samurai shodown": "Samurai Shodown",
  "SD F1 Grand Prix": "SD F-1 Grand Prix",
  "Secret Of Evermore (Ingles)": "Secret of Evermore (English)",
  "Secret Of Mana": "Secret of Mana",
  "Secret Of Mana 2": "Secret of Mana 2",
  "Secret Of The Stars": "Secret of the Stars",
  "SMK-F1-Tracks-by-MarioDesigner-2 0": "Super Mario Kart: F1 Tracks by MarioDesigner 2.0",
  "Star Fox [!]": "Star Fox",
  "Street Fighter 2 Alpha (No Good Dump Known)": "Street Fighter II Alpha",
  "Street Fighter 2 Turbo": "Street Fighter II Turbo",
  "Street Fighter Alpha 2 [!]": "Street Fighter Alpha 2",
  "Street Fighter II Turbo - Hyper Fighting": "Street Fighter II Turbo: Hyper Fighting",
  "Super Ghouls'N Ghosts": "Super Ghouls 'n Ghosts",
  "Super Mario All Stars": "Super Mario All-Stars",
  "Super Mario Kart [!]": "Super Mario Kart",
  "Super Mario RPG": "Super Mario RPG: Legend of the Seven Stars",
  "Super Street Fighter 2": "Super Street Fighter II",
  "Super Street Fighter II - The New Challengers": "Super Street Fighter II: The New Challengers (Japan)",
  "Super Street Fighter II - The New Challengers [!]": "Super Street Fighter II: The New Challengers",
  "super castlevania iv": "Super Castlevania IV",
  "super_punch-out!!": "Super Punch-Out!!",
  "swat kats - the radical squadron": "SWAT Kats: The Radical Squadron",
  "Tales of Phantasia PTBR": "Tales of Phantasia (PT-BR)",
  "Teenage Mutant Ninja Turtles IV - Turtles in Time [!]": "Teenage Mutant Ninja Turtles IV: Turtles in Time",
  "Tinytoon Adventures": "Tiny Toon Adventures",
  "Ultimate Kombat 3": "Ultimate Mortal Kombat 3",
  "Wonder Project J - Kikai no Shounen Pino (Japan) [En by WakdHacks v1 04] (-Wonder Project J - Mechanical Boy Pino)": "Wonder Project J: Kikai no Shōnen Pino",
  "Yuu Yuu Hakusho Final - Makai Saikyou Retsuden (Japan)": "Yu Yu Hakusho Final: Makai Saikyō Retsuden",
  "Yuu Yuu Hakuso 2": "Yu Yu Hakusho 2",
  "Zelda3": "The Legend of Zelda: A Link to the Past",
  "zelda3 RoxDownloadNet": "The Legend of Zelda: A Link to the Past (RoxDownloadNet)",
  "Zombies Ate My Neighbors [!]": "Zombies Ate My Neighbors",
});

const pickerView = document.querySelector("#picker-view");
const playerView = document.querySelector("#player-view");
const dropZone = document.querySelector("#drop-zone");
const romInput = document.querySelector("#rom-input");
const pickButton = document.querySelector("#pick-button");
const fileError = document.querySelector("#file-error");
const gameTitle = document.querySelector("#game-title");
const gameStage = document.querySelector("#game-stage");
const gameContainer = document.querySelector("#game");
const loadingOverlay = document.querySelector("#loading-overlay");
const homeButton = document.querySelector("#home-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const unlockCatalogButton = document.querySelector("#unlock-catalog-button");
const unlockDialog = document.querySelector("#unlock-dialog");
const unlockForm = document.querySelector("#unlock-form");
const passwordInput = document.querySelector("#catalog-password");
const rememberPasswordInput = document.querySelector("#remember-password");
const togglePasswordButton = document.querySelector("#toggle-password");
const unlockSubmit = document.querySelector("#unlock-submit");
const unlockStatus = document.querySelector("#unlock-status");
const catalogDialog = document.querySelector("#catalog-dialog");
const catalogSearch = document.querySelector("#catalog-search");
const catalogCount = document.querySelector("#catalog-count");
const catalogLetters = document.querySelector("#catalog-letters");
const catalogList = document.querySelector("#catalog-list");
const catalogSelection = document.querySelector("#catalog-selection");
const catalogStatus = document.querySelector("#catalog-status");
const playCatalogGameButton = document.querySelector("#play-catalog-game");
const progressMenu = document.querySelector("#progress-menu");
const progressStatus = document.querySelector("#progress-status");
const stateImportInput = document.querySelector("#state-import-input");
const saveImportInput = document.querySelector("#save-import-input");
const progressActionButtons = [...document.querySelectorAll("[data-progress-action]")];

let activeRom = null;
let emulatorMounted = false;
let isLeavingGame = false;
let catalogKey = null;
let catalogGames = [];
let selectedCatalogGame = null;
let preferredCatalogVariant = "pt-BR";
const catalogVariantInputs = [...document.querySelectorAll('input[name="catalog-variant"]')];
let activeCatalogLetter = "Todos";
let catalogBusy = false;
let progressBusy = false;
let progressMenuButton = null;

function extensionOf(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

function titleOf(fileName) {
  return fileName.replace(/\.[^.]+$/, "") || "ROM de Super Nintendo";
}

function canonicalCatalogTitle(title) {
  return CATALOG_TITLE_OVERRIDES[title] || title;
}

function displayCatalogGame(game) {
  const title = canonicalCatalogTitle(game.title);
  return title === game.title ? game : { ...game, title, storageTitle: game.title };
}

function numericHash(seed) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function gameIdFor(file, catalogId = "") {
  return numericHash(catalogId || `${file.name}:${file.size}:${file.lastModified}`);
}

function showError(message) {
  fileError.textContent = message;
  window.clearTimeout(showError.timeoutId);
  showError.timeoutId = window.setTimeout(() => {
    fileError.textContent = "";
  }, 7000);
}

function validateRom(file) {
  if (!(file instanceof File)) {
    return "Não foi possível ler esse arquivo. Tente selecioná-lo novamente.";
  }

  if (!SUPPORTED_EXTENSIONS.has(extensionOf(file.name))) {
    return "Formato não reconhecido. Use .sfc, .smc, .fig, .swc, .zip, .7z ou .rar.";
  }

  if (file.size === 0) {
    return "Esse arquivo está vazio. Escolha uma ROM válida.";
  }

  return "";
}

function showPlayer(file, metadata = {}) {
  const title = metadata.title || titleOf(file.name);
  pickerView.hidden = true;
  playerView.hidden = false;
  gameTitle.textContent = title;
  document.title = `${title} — ROM Nostalg`;
}

function configureEmulator(file, metadata = {}) {
  const title = metadata.title || titleOf(file.name);
  const storageTitle = metadata.storageTitle || title;
  window.EJS_player = "#game";
  window.EJS_core = "snes";
  window.EJS_controlScheme = "snes";
  window.EJS_defaultControls = window.ROMNostalgNetplayCore.createEmulatorControls();
  window.EJS_gameUrl = file;
  window.EJS_gameName = storageTitle;
  window.EJS_gameID = gameIdFor(file, metadata.id);
  window.EJS_pathtodata = EMULATOR_DATA_URL;
  window.EJS_startOnLoaded = true;
  window.EJS_fullscreenOnLoaded = false;
  window.EJS_threads = false;
  window.EJS_volume = 0.7;
  window.EJS_backgroundColor = "#050507";
  window.EJS_color = "#a989ff";
  window.EJS_language = "pt-BR";
  window.EJS_askBeforeExit = true;
  window.EJS_defaultOptions = {
    "save-state-location": "browser",
  };
  window.EJS_Buttons = {
    playPause: true,
    restart: true,
    mute: true,
    settings: true,
    fullscreen: true,
    saveState: {
      visible: true,
      displayName: "Salvar no navegador",
    },
    loadState: {
      visible: true,
      displayName: "Recuperar do navegador",
    },
    gamepad: true,
    volume: true,
    quickSave: true,
    quickLoad: true,
    screenRecord: false,
    cheat: false,
    screenshot: false,
    cacheManager: false,
    saveSavFiles: false,
    loadSavFiles: false,
    exitEmulation: false,
  };

  window.EJS_onGameStart = () => {
    migrateSnesGamepadBindings();
    window.ROMNostalgHostControlProfiles.attach(window.EJS_emulator);
    loadingOverlay.classList.add("is-hidden");
    installProgressMenuButton();
    scheduleGamepadAssignment();
    dispatchGameReady(metadata);
  };
}

function migrateSnesGamepadBindings() {
  const emulator = window.EJS_emulator;
  const settingsKey = emulator?.getLocalStorageKey?.();
  if (!settingsKey || !emulator.controls) return;
  const migrationKey = `rom-nostalg.snes-positions.v1:${settingsKey}`;
  try {
    if (window.localStorage.getItem(migrationKey)) return;
  } catch {
    // Still correct the active session when browser storage is unavailable.
  }

  const legacy = { 0: "BUTTON_2", 1: "BUTTON_4", 8: "BUTTON_1", 9: "BUTTON_3" };
  let changed = false;
  for (const bindings of Object.values(emulator.controls)) {
    // Only replace the complete old default quartet; keep customized layouts.
    if (!Object.entries(legacy).every(([input, button]) => bindings?.[input]?.value2 === button)) continue;
    for (const input of Object.keys(legacy)) {
      bindings[input].value2 = window.EJS_defaultControls[0][input].value2;
    }
    changed = true;
  }
  if (changed) emulator.checkGamepadInputs?.();
  try {
    if (changed) emulator.saveSettings();
    window.localStorage.setItem(migrationKey, "1");
  } catch {
    // The corrected inputs remain usable even if persisting settings fails.
  }
}

function installProgressMenuButton() {
  const emulator = window.EJS_emulator;
  const menu = emulator?.elements?.menu || gameContainer.querySelector(".ejs_menu_bar");
  if (!menu || menu.querySelector("[data-romnostalg-progress-menu]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ejs_menu_button";
  button.dataset.romnostalgProgressMenu = "";
  button.setAttribute("aria-label", "Transferir progresso");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" role="presentation" focusable="false">
      <path fill="currentColor" d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"></path>
    </svg>
    <span class="ejs_menu_text">Transferir progresso</span>
  `;
  emulator.addEventListener(button, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleProgressMenu();
  });
  const spacer = menu.querySelector(".ejs_menu_bar_spacer");
  menu.insertBefore(button, spacer || null);
  progressMenuButton = button;
}

function positionProgressMenu() {
  if (!progressMenuButton || progressMenu.hidden) return;

  const stageRect = gameStage.getBoundingClientRect();
  const buttonRect = progressMenuButton.getBoundingClientRect();
  const menuWidth = progressMenu.offsetWidth;
  const menuHeight = progressMenu.offsetHeight;
  const left = Math.min(
    Math.max(buttonRect.left - stageRect.left + buttonRect.width / 2 - menuWidth / 2, 8),
    stageRect.width - menuWidth - 8,
  );
  const aboveButton = buttonRect.top - stageRect.top - menuHeight - 8;
  const top = aboveButton >= 8
    ? aboveButton
    : Math.min(buttonRect.bottom - stageRect.top + 8, stageRect.height - menuHeight - 8);

  progressMenu.style.left = `${Math.round(left)}px`;
  progressMenu.style.top = `${Math.round(Math.max(8, top))}px`;
}

function closeProgressMenu() {
  if (progressBusy || progressMenu.hidden) return;
  progressMenu.hidden = true;
  progressMenuButton?.setAttribute("aria-expanded", "false");
}

function toggleProgressMenu() {
  if (!progressMenu.hidden) {
    closeProgressMenu();
    return;
  }

  progressStatus.textContent = "";
  progressStatus.classList.remove("is-error");
  progressMenu.hidden = false;
  progressMenuButton?.setAttribute("aria-expanded", "true");
  positionProgressMenu();
}

function activeGameManager() {
  const manager = window.EJS_emulator?.gameManager;
  if (!manager) {
    throw new Error("O emulador ainda está preparando o jogo.");
  }
  return manager;
}

function progressFileBaseName() {
  const safeTitle = gameTitle.textContent
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safeTitle || "rom-nostalg";
}

function downloadProgressFile(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setProgressBusy(busy) {
  progressBusy = busy;
  progressActionButtons.forEach((button) => {
    button.disabled = busy;
  });
}

function setProgressMessage(message, isError = false) {
  progressStatus.textContent = message;
  progressStatus.classList.toggle("is-error", isError);
}

async function runProgressTask(busyMessage, successMessage, task) {
  if (progressBusy) return;
  setProgressBusy(true);
  setProgressMessage(busyMessage);
  try {
    await task();
    setProgressMessage(successMessage);
  } catch (error) {
    setProgressMessage(error.message || "Não foi possível concluir esta ação.", true);
  } finally {
    setProgressBusy(false);
  }
}

async function exportStateFile() {
  const manager = activeGameManager();
  if (typeof manager.supportsStates === "function" && !manager.supportsStates()) {
    throw new Error("Este jogo não oferece suporte a estados.");
  }
  const state = manager.getState();
  downloadProgressFile(state, `${progressFileBaseName()}.state`);
}

async function importStateFile(file) {
  if (file.size === 0) {
    throw new Error("O arquivo de estado está vazio.");
  }
  if (file.size > 128 * 1024 * 1024) {
    throw new Error("O arquivo de estado é grande demais.");
  }
  const state = new Uint8Array(await file.arrayBuffer());
  activeGameManager().loadState(state);
}

async function exportSaveFile() {
  const manager = activeGameManager();
  if (typeof manager.getSaveFile !== "function") {
    throw new Error("Este jogo não oferece um save comum para exportar.");
  }
  const save = await manager.getSaveFile();
  const originalName = manager.getSaveFilePath?.().split("/").pop() || "jogo.srm";
  const extension = originalName.match(/\.[a-z0-9]+$/i)?.[0] || ".srm";
  downloadProgressFile(save, `${progressFileBaseName()}${extension}`);
}

async function importSaveFile(file) {
  if (file.size === 0) {
    throw new Error("O arquivo de save está vazio.");
  }
  if (file.size > 16 * 1024 * 1024) {
    throw new Error("O arquivo de save é grande demais.");
  }

  const manager = activeGameManager();
  const path = manager.getSaveFilePath?.();
  if (!path || !manager.FS || typeof manager.loadSaveFiles !== "function") {
    throw new Error("Este jogo não oferece importação de save comum.");
  }

  const pathParts = path.split("/");
  let currentPath = "";
  for (const part of pathParts.slice(0, -1)) {
    if (!part) continue;
    currentPath += `/${part}`;
    if (!manager.FS.analyzePath(currentPath).exists) {
      manager.FS.mkdir(currentPath);
    }
  }

  if (manager.FS.analyzePath(path).exists) {
    manager.FS.unlink(path);
  }
  manager.FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
  await manager.loadSaveFiles();
}

progressActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.progressAction;
    if (action === "export-state") {
      void runProgressTask("Preparando estado…", "Estado exportado.", exportStateFile);
    } else if (action === "import-state") {
      stateImportInput.value = "";
      stateImportInput.click();
    } else if (action === "export-save") {
      void runProgressTask("Preparando save…", "Save do jogo exportado.", exportSaveFile);
    } else if (action === "import-save") {
      saveImportInput.value = "";
      saveImportInput.click();
    }
  });
});

stateImportInput.addEventListener("change", () => {
  const [file] = stateImportInput.files;
  if (file) {
    void runProgressTask("Carregando estado…", "Estado importado.", () => importStateFile(file));
  }
});

saveImportInput.addEventListener("change", () => {
  const [file] = saveImportInput.files;
  if (file) {
    void runProgressTask("Carregando save…", "Save importado. Reinicie o jogo se necessário.", () => importSaveFile(file));
  }
});

document.addEventListener("pointerdown", (event) => {
  if (
    progressMenu.hidden
    || progressBusy
    || progressMenu.contains(event.target)
    || progressMenuButton?.contains(event.target)
  ) {
    return;
  }
  closeProgressMenu();
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !progressMenu.hidden && !progressBusy) {
    event.stopPropagation();
    closeProgressMenu();
    progressMenuButton?.focus({ preventScroll: true });
  }
});

window.addEventListener("resize", positionProgressMenu);
document.addEventListener("fullscreenchange", () => window.requestAnimationFrame(positionProgressMenu));

function dispatchGameReady(metadata = {}) {
  const source = metadata.source === "catalog" ? "catalog" : "local";
  window.dispatchEvent(new CustomEvent("romnostalg:game-ready", { detail: { source } }));
}

function showLoaderFailure() {
  loadingOverlay.classList.add("is-error");
  loadingOverlay.innerHTML = `
    <strong>Não foi possível carregar o emulador.</strong>
    <span>Confira sua internet e recarregue a página para tentar novamente.</span>
  `;
}

function mountEmulator(metadata = {}) {
  const observer = new MutationObserver(() => {
    if (gameContainer.childElementCount > 0) {
      emulatorMounted = true;
      loadingOverlay.classList.add("is-hidden");
      scheduleGamepadAssignment();
      dispatchGameReady(metadata);
      observer.disconnect();
    }
  });

  observer.observe(gameContainer, { childList: true });

  const loader = document.createElement("script");
  loader.src = `${EMULATOR_DATA_URL}loader.js`;
  loader.async = true;
  loader.dataset.emulatorLoader = EMULATOR_VERSION;
  loader.addEventListener("error", () => {
    observer.disconnect();
    showLoaderFailure();
  });
  document.body.append(loader);
}

function loadRom(file, metadata = {}) {
  const validationError = validateRom(file);

  if (validationError) {
    showError(validationError);
    romInput.value = "";
    return;
  }

  if (activeRom) {
    return;
  }

  activeRom = file;
  dropZone.classList.add("is-loading");
  fileError.textContent = "";
  showPlayer(file, metadata);
  configureEmulator(file, metadata);
  mountEmulator(metadata);
}

function openFilePicker() {
  if (!activeRom) {
    romInput.click();
  }
}

pickButton.addEventListener("click", (event) => {
  event.stopPropagation();
  openFilePicker();
});

romInput.addEventListener("change", () => {
  const [file] = romInput.files || [];
  if (file) {
    loadRom(file);
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files || [])];

  if (files.length > 1) {
    showError("Solte apenas uma ROM por vez.");
    return;
  }

  if (files[0]) {
    loadRom(files[0]);
  }
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

function connectedGamepads() {
  if (typeof navigator.getGamepads !== "function") {
    return [];
  }

  return [...navigator.getGamepads()].filter(Boolean);
}

function trackedEmulatorGamepads() {
  const tracked = window.EJS_emulator?.gamepad?.gamepads;

  if (Array.isArray(tracked)) {
    return tracked.filter(Boolean);
  }

  if (tracked instanceof Map) {
    return [...tracked.values()].filter(Boolean);
  }

  if (tracked && typeof tracked === "object") {
    return Object.values(tracked).filter(Boolean);
  }

  return [];
}

function gamepadToken(gamepad) {
  if (!gamepad || typeof gamepad.id !== "string" || !Number.isInteger(gamepad.index)) {
    return "";
  }

  return `${gamepad.id}_${gamepad.index}`;
}

function autoAssignPlayerOne() {
  const emulator = window.EJS_emulator;
  const selection = emulator?.gamepadSelection;

  if (!Array.isArray(selection)) {
    return false;
  }

  if (selection[0]) {
    updateGamepadStatus();
    return true;
  }

  const gamepad = trackedEmulatorGamepads()[0] || connectedGamepads()[0];
  const token = gamepadToken(gamepad);

  if (!token) {
    return false;
  }

  selection[0] = token;
  emulator.updateGamepadLabels?.();
  updateGamepadStatus();
  return true;
}

function scheduleGamepadAssignment() {
  for (const delay of [0, 250, 1000, 2500]) {
    window.setTimeout(autoAssignPlayerOne, delay);
  }
}

function updateGamepadStatus() {
  const count = connectedGamepads().length;
  const ready = Boolean(window.EJS_emulator?.gamepadSelection?.[0]);
  const label = count === 0
    ? "Nenhum controle detectado"
    : ready
      ? "Controle pronto para jogar"
      : count === 1
        ? "Controle conectado"
        : `${count} controles conectados`;

  document.querySelectorAll("[data-gamepad-status]").forEach((element) => {
    element.textContent = label;
  });

  document.querySelectorAll("[data-gamepad-dot]").forEach((element) => {
    element.classList.toggle("is-connected", count > 0);
  });
}

window.addEventListener("gamepadconnected", () => {
  updateGamepadStatus();
  scheduleGamepadAssignment();
});
window.addEventListener("gamepaddisconnected", updateGamepadStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateGamepadStatus();
    scheduleGamepadAssignment();
  }
});
updateGamepadStatus();

function bytesFromBase64(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function deriveCatalogKey(password, kdf) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesFromBase64(kdf.salt),
      iterations: kdf.iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

function validEnvelope(envelope) {
  const hasExpectedShape = envelope?.version === 1
    && envelope.kdf?.name === "PBKDF2"
    && envelope.kdf?.hash === "SHA-256"
    && Number.isInteger(envelope.kdf?.iterations)
    && envelope.kdf.iterations >= 100_000
    && envelope.kdf.iterations <= 1_500_000
    && typeof envelope.kdf?.salt === "string"
    && envelope.cipher?.name === "AES-GCM"
    && typeof envelope.cipher?.iv === "string"
    && typeof envelope.payload === "string";

  if (!hasExpectedShape) {
    return false;
  }

  try {
    return bytesFromBase64(envelope.kdf.salt).length === 16
      && bytesFromBase64(envelope.cipher.iv).length === 12
      && bytesFromBase64(envelope.payload).length > 16;
  } catch {
    return false;
  }
}

function validCatalogGame(game, manifestVersion) {
  return typeof game?.id === "string"
    && typeof game?.title === "string"
    && game.title.trim().length > 0
    && typeof game?.fileName === "string"
    && SUPPORTED_EXTENSIONS.has(extensionOf(game.fileName))
    && /^assets\/[a-f0-9]+\.bin$/i.test(game?.asset || "")
    && Number.isSafeInteger(game?.size)
    && game.size > 0
    && (manifestVersion === 1 || /^[a-f0-9]{64}$/i.test(game?.sha256 || ""));
}

function setUnlockBusy(isBusy, message = null) {
  catalogBusy = isBusy;
  unlockSubmit.disabled = isBusy;
  passwordInput.disabled = isBusy;
  togglePasswordButton.disabled = isBusy;
  if (message !== null) {
    unlockStatus.classList.remove("is-error");
    unlockStatus.textContent = message;
  }
}

function setUnlockError(message) {
  unlockStatus.classList.add("is-error");
  unlockStatus.textContent = message;
}

function savedCatalogPassword() {
  try {
    return window.localStorage.getItem(SAVED_PASSWORD_KEY) || "";
  } catch {
    return "";
  }
}

function updateSavedCatalogPassword(password) {
  try {
    if (rememberPasswordInput.checked) {
      window.localStorage.setItem(SAVED_PASSWORD_KEY, password);
    } else {
      window.localStorage.removeItem(SAVED_PASSWORD_KEY);
    }
  } catch {
    // O desbloqueio continua funcionando quando o armazenamento local está bloqueado.
  }
}

function rememberActiveCatalogPassword(password) {
  try {
    window.sessionStorage.setItem(ACTIVE_CATALOG_PASSWORD_KEY, password);
  } catch {
    // Sem armazenamento de sessão, o retorno cai no fluxo normal de desbloqueio.
  }
}

function requestCatalogReopen() {
  try {
    window.sessionStorage.setItem(REOPEN_CATALOG_KEY, "1");
  } catch {
    // O retorno ainda libera o jogo, mesmo se a sessão estiver bloqueada.
  }
}

function consumeCatalogReopenRequest() {
  try {
    const shouldReopen = window.sessionStorage.getItem(REOPEN_CATALOG_KEY) === "1";
    window.sessionStorage.removeItem(REOPEN_CATALOG_KEY);
    return shouldReopen;
  } catch {
    return false;
  }
}

function activeCatalogPassword() {
  try {
    return window.sessionStorage.getItem(ACTIVE_CATALOG_PASSWORD_KEY) || savedCatalogPassword();
  } catch {
    return savedCatalogPassword();
  }
}

function normalizedSearch(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR");
}

function letterFor(title) {
  const first = normalizedSearch(title.trim()).charAt(0);
  return CATALOG_LETTERS.includes(first) ? first : "#";
}

function updateCatalogSelection() {
  const version = window.RomCatalogModel.selectedVersion(selectedCatalogGame, preferredCatalogVariant);
  catalogSelection.textContent = version
    ? `${version.title} · ${version.variant === "pt-BR" ? "Traduzido" : "Original"}`
    : "Nenhum jogo selecionado";
  playCatalogGameButton.disabled = !selectedCatalogGame || catalogBusy;
  playCatalogGameButton.classList.toggle("is-translated", version?.variant === "pt-BR");
  for (const input of catalogVariantInputs) {
    input.disabled = catalogBusy || !selectedCatalogGame?.variants[input.value];
    input.checked = version?.variant === input.value;
    input.parentElement.title = !selectedCatalogGame ? "Selecione um jogo"
      : !selectedCatalogGame.variants[input.value] ? "Versão não disponível neste catálogo" : "";
  }

  catalogList.querySelectorAll(".catalog-game").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.gameId === selectedCatalogGame?.id));
  });
}

for (const input of catalogVariantInputs) {
  input.addEventListener("change", () => {
    if (input.checked && !catalogBusy) {
      preferredCatalogVariant = input.value;
      updateCatalogSelection();
    }
  });
}

function renderCatalogLetters() {
  const available = new Set(catalogGames.map((game) => letterFor(game.title)));
  catalogLetters.replaceChildren();

  for (const letter of ["Todos", ...CATALOG_LETTERS]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = letter;
    button.disabled = letter !== "Todos" && !available.has(letter);
    button.classList.toggle("is-active", activeCatalogLetter === letter);
    button.setAttribute("aria-pressed", String(activeCatalogLetter === letter));
    button.addEventListener("click", () => {
      activeCatalogLetter = letter;
      catalogSearch.value = "";
      renderCatalog();
    });
    catalogLetters.append(button);
  }
}

function renderCatalog() {
  const query = normalizedSearch(catalogSearch.value.trim());
  const visibleGames = catalogGames.filter((game) => {
    const matchesLetter = activeCatalogLetter === "Todos" || letterFor(game.title) === activeCatalogLetter;
    return matchesLetter && (!query || normalizedSearch(game.title).includes(query));
  });

  catalogCount.textContent = `${visibleGames.length} ${visibleGames.length === 1 ? "jogo" : "jogos"}`;
  catalogList.replaceChildren();
  renderCatalogLetters();

  if (visibleGames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "catalog-empty";
    empty.textContent = "Nenhum jogo encontrado.";
    catalogList.append(empty);
    updateCatalogSelection();
    return;
  }

  const groups = new Map();
  for (const game of visibleGames) {
    const letter = letterFor(game.title);
    if (!groups.has(letter)) {
      groups.set(letter, []);
    }
    groups.get(letter).push(game);
  }

  for (const [letter, games] of groups) {
    const section = document.createElement("section");
    section.className = "catalog-group";
    const heading = document.createElement("h3");
    heading.textContent = letter;
    section.append(heading);

    for (const game of games) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-game";
      button.dataset.gameId = game.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(game.id === selectedCatalogGame?.id));
      button.setAttribute("aria-label", game.title);

      const letterBadge = document.createElement("span");
      letterBadge.className = "game-letter";
      letterBadge.textContent = letter;
      const name = document.createElement("span");
      name.className = "game-name";
      name.textContent = game.title;
      const badges = document.createElement("span");
      badges.className = "game-versions";
      const available = [];
      for (const [variant, label] of [["original", "Original"], ["pt-BR", "Traduzido em português"]]) {
        if (!game.variants[variant]) continue;
        const badge = document.createElement("span");
        badge.className = variant === "original" ? "version-original" : "version-brazil";
        badge.title = label;
        badge.setAttribute("aria-hidden", "true");
        if (variant === "original") badge.textContent = "®";
        badges.append(badge);
        available.push(label);
      }
      button.setAttribute("aria-label", `${game.title}, ${available.join(" e ")}`);
      const check = document.createElement("span");
      check.className = "game-check";
      check.setAttribute("aria-hidden", "true");
      button.append(letterBadge, name, badges, check);
      button.addEventListener("click", () => {
        if (catalogBusy) return;
        selectedCatalogGame = game;
        updateCatalogSelection();
      });
      button.addEventListener("dblclick", () => {
        if (catalogBusy) return;
        selectedCatalogGame = game;
        updateCatalogSelection();
        playSelectedCatalogGame();
      });
      section.append(button);
    }

    catalogList.append(section);
  }

  updateCatalogSelection();
}

function openCatalog() {
  activeCatalogLetter = "Todos";
  catalogSearch.value = "";
  catalogStatus.textContent = "";
  renderCatalog();
  if (!catalogDialog.open) {
    catalogDialog.showModal();
  }
}

function showCatalogRestoring() {
  catalogCount.textContent = "Abrindo…";
  catalogLetters.replaceChildren();
  catalogList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "catalog-empty";
  loading.textContent = "Preparando catálogo…";
  catalogList.append(loading);
  catalogSelection.textContent = "Carregando jogos";
  catalogStatus.textContent = "";
  playCatalogGameButton.disabled = true;
  if (!catalogDialog.open) {
    catalogDialog.showModal();
  }
}

async function unlockCatalog(password) {
  if (!window.crypto?.subtle) {
    throw new Error("Este navegador não oferece a criptografia necessária.");
  }

  const response = await fetch(CATALOG_URL, { cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("O catálogo ainda não foi configurado neste site.");
    }
    throw new Error("Não foi possível baixar o catálogo. Tente novamente.");
  }

  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("O catálogo não contém um manifesto válido.");
  }
  if (!validEnvelope(envelope)) {
    throw new Error("O catálogo está em um formato inválido.");
  }

  const key = await deriveCatalogKey(password, envelope.kdf);
  let clearBytes;

  try {
    clearBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesFromBase64(envelope.cipher.iv) },
      key,
      bytesFromBase64(envelope.payload),
    );
  } catch {
    throw new Error("Senha incorreta ou catálogo danificado.");
  }

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(clearBytes));
  } catch {
    throw new Error("Não foi possível ler o catálogo descriptografado.");
  }

  const supportedManifest = manifest?.version === 1
    || (manifest?.version === 2 && manifest.system === CATALOG_SYSTEM);
  if (!supportedManifest
    || !Array.isArray(manifest.games)
    || !manifest.games.every((game) => validCatalogGame(game, manifest.version))) {
    throw new Error("O conteúdo do catálogo é inválido.");
  }

  catalogKey = key;
  catalogGames = window.RomCatalogModel.groupGames(manifest.games.map(displayCatalogGame));

  if (catalogGames.length === 0) {
    throw new Error("O catálogo não contém jogos.");
  }
}

unlockCatalogButton.addEventListener("click", () => {
  if (catalogKey && catalogGames.length > 0) {
    openCatalog();
    return;
  }

  unlockStatus.textContent = "";
  unlockStatus.classList.remove("is-error");
  const savedPassword = savedCatalogPassword();
  passwordInput.value = savedPassword;
  rememberPasswordInput.checked = Boolean(savedPassword);
  if (!unlockDialog.open) {
    unlockDialog.showModal();
  }
  window.setTimeout(() => passwordInput.focus(), 0);
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;

  if (password.length < 16) {
    setUnlockError("A senha do catálogo tem pelo menos 16 caracteres.");
    passwordInput.focus();
    return;
  }

  setUnlockBusy(true, "Verificando e descriptografando…");
  try {
    await unlockCatalog(password);
    rememberActiveCatalogPassword(password);
    updateSavedCatalogPassword(password);
    passwordInput.value = "";
    unlockDialog.close();
    openCatalog();
  } catch (error) {
    setUnlockError(error.message);
  } finally {
    setUnlockBusy(false);
  }
});

togglePasswordButton.addEventListener("click", () => {
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  togglePasswordButton.textContent = reveal ? "Ocultar" : "Mostrar";
  togglePasswordButton.setAttribute("aria-label", reveal ? "Ocultar senha" : "Mostrar senha");
  passwordInput.focus();
});

rememberPasswordInput.addEventListener("change", () => {
  if (!rememberPasswordInput.checked) {
    try {
      window.localStorage.removeItem(SAVED_PASSWORD_KEY);
    } catch {
      // O navegador pode bloquear armazenamento local em modos mais restritos.
    }
  }
});

document.querySelector("[data-close-unlock]").addEventListener("click", () => {
  if (!catalogBusy) {
    passwordInput.value = "";
    unlockDialog.close();
  }
});

document.querySelector("[data-close-catalog]").addEventListener("click", () => {
  if (!catalogBusy) {
    catalogDialog.close();
  }
});

for (const dialog of [unlockDialog, catalogDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !catalogBusy) {
      dialog.close();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (catalogBusy) {
      event.preventDefault();
    }
  });
}

unlockDialog.addEventListener("close", () => {
  if (!rememberPasswordInput.checked) {
    passwordInput.value = "";
  }
  passwordInput.type = "password";
  togglePasswordButton.textContent = "Mostrar";
  togglePasswordButton.setAttribute("aria-label", "Mostrar senha");
});

catalogSearch.addEventListener("input", () => {
  activeCatalogLetter = "Todos";
  renderCatalog();
});

async function decryptCatalogGame(game) {
  const assetUrl = new URL(game.asset, CATALOG_URL);
  const allowedAssetRoot = new URL("./assets/", CATALOG_URL);

  if (assetUrl.origin !== allowedAssetRoot.origin || !assetUrl.pathname.startsWith(allowedAssetRoot.pathname)) {
    throw new Error("O endereço deste jogo é inválido.");
  }

  const response = await fetch(assetUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Não foi possível baixar o jogo selecionado.");
  }

  const encrypted = new Uint8Array(await response.arrayBuffer());
  if (encrypted.length <= 28) {
    throw new Error("O arquivo criptografado está incompleto.");
  }

  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  let clearBytes;

  try {
    clearBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, catalogKey, ciphertext);
  } catch {
    throw new Error("Não foi possível descriptografar este jogo.");
  }

  if (clearBytes.byteLength !== game.size) {
    throw new Error("O tamanho do jogo não confere com o catálogo.");
  }

  return new File([clearBytes], game.fileName, { lastModified: 0 });
}

async function playSelectedCatalogGame() {
  if (!selectedCatalogGame || catalogBusy || activeRom) {
    return;
  }

  catalogBusy = true;
  updateCatalogSelection();
  catalogStatus.classList.remove("is-error");
  catalogStatus.textContent = "Baixando e descriptografando…";

  try {
    const game = window.RomCatalogModel.selectedVersion(selectedCatalogGame, preferredCatalogVariant);
    const file = await decryptCatalogGame(game);
    catalogDialog.close();
    loadRom(file, {
      id: game.id,
      title: game.title,
      storageTitle: game.storageTitle,
      source: "catalog",
    });
  } catch (error) {
    catalogStatus.classList.add("is-error");
    catalogStatus.textContent = error.message;
  } finally {
    catalogBusy = false;
    if (!activeRom) {
      updateCatalogSelection();
    }
  }
}

playCatalogGameButton.addEventListener("click", playSelectedCatalogGame);

async function reopenCatalogAfterGame() {
  if (!consumeCatalogReopenRequest()) {
    return;
  }

  const password = activeCatalogPassword();
  if (!password) {
    unlockCatalogButton.click();
    return;
  }

  catalogBusy = true;
  showCatalogRestoring();
  try {
    await unlockCatalog(password);
    openCatalog();
  } catch (error) {
    catalogDialog.close();
    passwordInput.value = savedCatalogPassword();
    rememberPasswordInput.checked = Boolean(passwordInput.value);
    setUnlockError(error.message);
    unlockDialog.showModal();
  } finally {
    catalogBusy = false;
    updateCatalogSelection();
  }
}

async function returnToCatalog() {
  if (isLeavingGame) {
    return;
  }

  isLeavingGame = true;
  homeButton.disabled = true;
  window.dispatchEvent(new CustomEvent("romnostalg:game-leaving"));

  try {
    await window.ROMNostalgNetplay?.leave?.({ closeRoom: true });
  } catch {
    // The room also expires server-side; leaving the game must never get stuck.
  }

  activeRom = null;
  emulatorMounted = false;
  window.EJS_askBeforeExit = false;
  requestCatalogReopen();

  try {
    if (currentFullscreenElement()) {
      await exitFullscreen();
    }
  } finally {
    window.location.reload();
  }
}

homeButton.addEventListener("click", returnToCatalog);
if (!window.ROMNostalgNetplayCore?.parseInviteHash(window.location.hash)) {
  void reopenCatalogAfterGame();
}

function currentFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function requestStageFullscreen() {
  if (gameStage.requestFullscreen) {
    await gameStage.requestFullscreen();
    return;
  }

  if (gameStage.webkitRequestFullscreen) {
    gameStage.webkitRequestFullscreen();
    return;
  }

  throw new Error("Fullscreen API indisponível");
}

async function exitFullscreen() {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }

  if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
}

async function toggleFullscreen() {
  try {
    if (currentFullscreenElement()) {
      await exitFullscreen();
    } else {
      await requestStageFullscreen();
    }
  } catch {
    showError("O navegador bloqueou a tela cheia. Use o botão do próprio emulador.");
  }
}

fullscreenButton.addEventListener("click", toggleFullscreen);

document.addEventListener("keydown", (event) => {
  if (event.key === "F11" && activeRom) {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  } else if (event.key === "Escape" && currentFullscreenElement()) {
    event.preventDefault();
    exitFullscreen();
  }
}, true);

function syncFullscreenUi() {
  const isFullscreen = Boolean(currentFullscreenElement());
  document.body.classList.toggle("is-fullscreen", isFullscreen);
  fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia",
  );
  fullscreenButton.querySelector("span").textContent = isFullscreen ? "Sair da tela cheia" : "Tela cheia";
}

document.addEventListener("fullscreenchange", syncFullscreenUi);
document.addEventListener("webkitfullscreenchange", syncFullscreenUi);

window.addEventListener("beforeunload", (event) => {
  if (isLeavingGame || !activeRom || !emulatorMounted) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});
