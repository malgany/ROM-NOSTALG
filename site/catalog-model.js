(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RomCatalogModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const portuguese = /\bPT[- ]?BR\b|\(BR\)/i;

  function cleanDisplayTitle(title) {
    return title.replace(/\s*[([](?:PT[- ]?BR|BR)[)\]]/gi, "")
      .replace(/\s+PT[- ]?BR\b/gi, "").trim();
  }

  function groupGames(games) {
    const groups = new Map();
    for (const game of games) {
      const hasMetadata = ["groupId", "variant", "displayTitle"].some((key) => game[key] !== undefined);
      if (hasMetadata && (!/^[a-z0-9-]+$/.test(game.groupId || "")
        || !["original", "pt-BR"].includes(game.variant)
        || typeof game.displayTitle !== "string" || !game.displayTitle.trim())) {
        throw new Error("Metadados de versões inválidos no catálogo.");
      }
      // Legacy entries never merge by title: similar names can be different hacks.
      const id = hasMetadata ? `group:${game.groupId}` : `game:${game.id}`;
      const title = game.displayTitle || cleanDisplayTitle(game.title);
      const variant = game.variant || (portuguese.test(game.title) ? "pt-BR" : "original");
      const group = groups.get(id) || { id, title, variants: {} };
      if (group.title !== title || group.variants[variant]) {
        throw new Error("Grupo com títulos divergentes ou versões duplicadas no catálogo.");
      }
      group.variants[variant] = { ...game, title, storageTitle: game.storageTitle || game.title, variant };
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }));
  }

  function selectedVersion(group, preference) {
    return group?.variants[preference] || group?.variants["pt-BR"] || group?.variants.original || null;
  }

  function originalFlag(game) {
    // Read release tags, never guess a language from the game's name or developer.
    const source = game.fileName || game.storageTitle || game.title || "";
    const tags = [...source.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().matchAll(/\(([^()]*)\)|\[([^\[\]]*)\]/g)]
      .map((match) => (match[1] || match[2]).trim());
    const languages = {
      en: "usa", eng: "usa", english: "usa", ingles: "usa",
      ja: "japan", jp: "japan", jpn: "japan", japanese: "japan", japones: "japan",
      fr: "france", fre: "france", french: "france", frances: "france",
      de: "germany", ger: "germany", german: "germany", alemao: "germany",
      es: "spain", spa: "spain", spanish: "spain", espanhol: "spain",
      it: "italy", ita: "italy", italian: "italy", italiano: "italy",
    };
    const languageFlag = (token) => Object.hasOwn(languages, token) ? languages[token] : null;

    // Translation tags such as [En by ...] and [T+Eng1.0] override the release region.
    for (const tag of tags) {
      const translation = tag.match(/^t[+-]([a-z]+)(?=$|\d|\s)/)
        || tag.match(/^([a-z]+)(?=\d|\s+v?\d|\s+by\b)/);
      const flag = translation && languageFlag(translation[1]);
      if (flag) return flag;
    }
    const explicitLanguages = tags.flatMap((tag) => {
      const flags = tag.split(",").map((token) => languageFlag(token.trim()));
      return flags.every(Boolean) ? flags : [];
    });
    if (explicitLanguages.length) {
      return explicitLanguages.includes("usa") ? "usa" : explicitLanguages[0];
    }

    const regions = tags.flatMap((tag) => tag.split(",").map((token) => token.trim()));
    for (const [flag, pattern] of [
      ["usa", /^(?:u|us|usa|uk|e|eu|eur|europe|w|world|usa & europe)$/],
      ["japan", /^(?:j|jp|jpn|japan)$/],
      ["france", /^(?:f|france)$/],
      ["germany", /^(?:g|germany)$/],
      ["spain", /^(?:s|spain)$/],
      ["italy", /^(?:i|italy)$/],
    ]) {
      if (regions.some((region) => pattern.test(region))) return flag;
    }
    return "usa";
  }

  return Object.freeze({ groupGames, selectedVersion, originalFlag });
});
