const test = require('node:test');
const assert = require('node:assert/strict');
const { groupGames, selectedVersion, originalFlag } = require('../catalog-model.js');
const original = { id: 'a1', title: 'Super Mario World', fileName: 'SMW.smc', groupId: 'smw', displayTitle: 'Super Mario World', variant: 'original' };
const translation = { ...original, id: 'a2', title: 'Super Mario World (PT-BR)', fileName: 'SMW-PT.zip', variant: 'pt-BR' };
const hack = { ...translation, id: 'a3', title: 'Super Mario World 2025 (PT-BR)', groupId: 'smw-hack-2025', displayTitle: 'Super Mario World Hack 2025' };

test('groups declared versions but keeps the 2025 hack and per-ROM save identities separate', () => {
  const groups = groupGames([original, translation, hack]);
  assert.equal(groups.length, 2);
  assert.deepEqual(Object.keys(groups[0].variants), ['original', 'pt-BR']);
  const pt = selectedVersion(groups[0], 'pt-BR');
  assert.equal(pt.id, 'a2');
  assert.equal(pt.fileName, 'SMW-PT.zip');
  assert.equal(pt.storageTitle, 'Super Mario World (PT-BR)');
  assert.equal(selectedVersion(groups[0], 'original').id, 'a1');
  assert.equal(selectedVersion(groups[1], 'original').id, 'a3');
  assert.equal(groups[1].title, 'Super Mario World Hack 2025');
});

test('legacy similar titles do not merge; unavailable languages resolve to the actual variant', () => {
  const groups = groupGames([{ id: 'b1', title: 'Mario' }, { id: 'b2', title: 'Mario (PT-BR)' }]);
  assert.equal(groups.length, 2);
  assert.equal(selectedVersion(groups[0], 'pt-BR').variant, 'original');
  assert.equal(selectedVersion(groups[1], 'original').variant, 'pt-BR');
  assert.equal(selectedVersion(null, 'original'), null);
});

test('rejects conflicting grouping metadata', () => {
  assert.throws(() => groupGames([original, { ...original, id: 'c2' }]), /duplicadas/);
  assert.throws(() => groupGames([original, { ...translation, displayTitle: 'Other hack' }]), /divergentes/);
  assert.throws(() => groupGames([{ ...original, variant: 'unknown' }]), /inválidos/);
});

test('original flags prioritize language and translation tags over release regions', () => {
  for (const [fileName, flag] of [
    ['Example (Japan) [En by Example Team v1.0].zip', 'usa'],
    ['Example (J) [T+Eng1.0].smc', 'usa'],
    ['Example (Ja) [T+Eng].smc', 'usa'],
    ['Example (Japan) (En,Ja).zip', 'usa'],
    ['Example (Inglês).smc', 'usa'],
    ['Example (Japan) (English).zip', 'usa'],
    ['Example (J) (Fr).zip', 'france'],
    ['Example (USA) [De by Example Team].zip', 'germany'],
    ['Example (Europe) (Es).zip', 'spain'],
    ['Example (Europe) (It).zip', 'italy'],
    ['Example (Europe) (Ja).zip', 'japan'],
  ]) {
    assert.equal(originalFlag({ fileName }), flag, fileName);
  }
});

test('original flags use region tags conservatively and default to the USA', () => {
  for (const [fileName, flag] of [
    ['Example_(J).smc', 'japan'],
    ['Example (Japan).zip', 'japan'],
    ['Example (JPN).zip', 'japan'],
    ['Example (USA, Japan).zip', 'usa'],
    ['Example (Europe).zip', 'usa'],
    ['Example (E) [h1].zip', 'usa'],
    ['Example (U) [!].smc', 'usa'],
    ['Example (France).zip', 'france'],
    ['Example (Germany).zip', 'germany'],
    ['Example (Spain).zip', 'spain'],
    ['Example (Italy).zip', 'italy'],
    ['Example (Unknown).zip', 'usa'],
    ['Japanese Adventure.smc', 'usa'],
    ['Example [J Team].zip', 'usa'],
    ['Example (constructor).zip', 'usa'],
  ]) {
    assert.equal(originalFlag({ fileName }), flag, fileName);
  }
  const [group] = groupGames([{ ...original, fileName: 'Example (J).zip' }]);
  assert.equal(originalFlag(group.variants.original), 'japan');
  assert.equal(group.variants.original.variant, 'original');
  assert.equal(group.variants.original.id, original.id);
});
