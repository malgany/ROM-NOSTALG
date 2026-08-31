const test = require('node:test');
const assert = require('node:assert/strict');
const { groupGames, selectedVersion } = require('../catalog-model.js');
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
