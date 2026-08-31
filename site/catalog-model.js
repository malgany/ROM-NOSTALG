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

  return Object.freeze({ groupGames, selectedVersion });
});
