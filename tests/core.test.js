// Tests des gemeinsamen Anwendungsrahmens (DOM-freie Teile)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptExampleMeta } from '../js/core/app.js';

test('Beispiel laden: Name und Bemerkungen des Beispiels füllen leere Projektangaben', () => {
  const fresh = { name: 'Neues Projekt', author: '', number: '', date: '7.11.2026', comment: '' };
  const ex = { name: 'Kellerwand MK 25 cm' };
  const m = adoptExampleMeta(fresh, ex, { name: 'intern', comment: 'Kelleraussenwand mit Erdanschüttung' });
  assert.equal(m.name, 'Kellerwand MK 25 cm');
  assert.equal(m.comment, 'Kelleraussenwand mit Erdanschüttung');
  assert.equal(m.date, '7.11.2026');
  assert.equal(fresh.comment, '', 'Eingabe wird nicht verändert');
});

test('Beispiel laden: eigene Projektangaben bleiben erhalten', () => {
  const own = { name: 'Überbauung Areal Nord', author: 'S. M.', number: '24-017', date: '1.11.2026', comment: 'Vorprojekt' };
  const m = adoptExampleMeta(own, { name: 'Beispiel' }, { name: 'x', comment: 'Beispieltext', author: 'y' });
  assert.deepEqual(m, own);
});
