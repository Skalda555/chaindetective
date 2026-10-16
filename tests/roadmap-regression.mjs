import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../dist/roadmap.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 1, 'roadmap should have one inline state manager');
const [script] = scripts;
new Function(script);

const taskMatches = [...html.matchAll(/data-roadmap-item="([^"]+)" data-roadmap-stage="([1-7])"/g)];
const ids = taskMatches.map(match => match[1]);
assert.equal(ids.length, 32, 'all current implementation points should have a status');
assert.equal(new Set(ids).size, ids.length, 'roadmap task IDs must be unique');
assert.ok(!html.slice(html.indexOf('id="foundation"')).includes('data-roadmap-item='), 'completed foundation stays a historical list');

class Element {
  constructor({ id = '', dataset = {}, textContent = '' } = {}) {
    this.id = id;
    this.dataset = dataset;
    this.textContent = textContent;
    this.value = '';
    this.hidden = false;
    this.style = {};
    this.listeners = {};
    this.children = [];
    this.attributes = {};
    this.classList = { add() {} };
  }
  append(child) { this.children.push(child); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return selector === 'select' ? this.select : null; }
  dispatch(type) { this.listeners[type]?.({ target: this }); }
}

function createPage(storage = new Map(), confirmation = true) {
  const items = taskMatches.map(match => {
    const item = new Element({ dataset: { roadmapItem: match[1], roadmapStage: match[2] }, textContent: match[1] });
    item.classList = { add() {} };
    return item;
  });
  const elements = new Map();
  const add = (id, element = new Element({ id })) => (elements.set(id, element), element);
  add('roadmap-total-label');
  add('roadmap-status-filter').value = 'all';
  add('roadmap-reset');
  const totalBar = add('roadmap-total-bar');
  totalBar.parentElement = new Element();
  const stageCards = new Map();
  const activeStages = new Map();
  for (let stage = 1; stage <= 7; stage++) {
    add(`roadmap-stage-${stage}-label`);
    const bar = add(`roadmap-stage-${stage}-bar`);
    bar.parentElement = new Element();
    stageCards.set(String(stage), new Element());
    activeStages.set(String(stage), new Element());
  }
  const document = {
    querySelectorAll: selector => selector === '[data-roadmap-item]' ? items : [],
    getElementById: id => elements.get(id) ?? null,
    querySelector: selector => {
      const card = selector.match(/^\[data-roadmap-stage-card="(\d+)"\]$/);
      if (card) return stageCards.get(card[1]);
      const active = selector.match(/^\[data-roadmap-active-stage="(\d+)"\]$/);
      return active ? activeStages.get(active[1]) : null;
    },
    createElement: () => new Element(),
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const window = { confirm: () => confirmation };
  runInNewContext(script, { document, localStorage, window, Set, JSON, Math });
  for (const item of items) {
    item.select = item.children[0].children[0];
  }
  return { items, elements, stageCards, activeStages, storage, setConfirmation: value => { confirmation = value; } };
}

const storage = new Map();
const page = createPage(storage);
assert.equal(page.elements.get('roadmap-total-label').textContent, '0 / 32 hotovo · 0 %');
assert.equal(page.elements.get('roadmap-stage-1-label').textContent, '0 / 8 hotovo · 0 %');

const first = page.items[0];
first.select.value = 'done';
first.select.dispatch('change');
assert.equal(page.elements.get('roadmap-total-label').textContent, '1 / 32 hotovo · 3 %');
assert.equal(page.elements.get('roadmap-stage-1-label').textContent, '1 / 8 hotovo · 13 %');
assert.equal(JSON.parse(storage.get('chaindetective.roadmap.state.v1'))[first.dataset.roadmapItem], 'done');

const secondStage = page.items.find(item => item.dataset.roadmapStage === '2');
secondStage.select.value = 'in-progress';
secondStage.select.dispatch('change');
const filter = page.elements.get('roadmap-status-filter');
filter.value = 'done';
filter.dispatch('change');
assert.equal(first.hidden, false, 'done filter should keep completed tasks visible');
assert.equal(secondStage.hidden, true, 'done filter should hide in-progress tasks');
assert.equal(page.stageCards.get('2').hidden, true, 'stages without matching tasks should collapse from filtered view');
filter.value = 'in-progress';
filter.dispatch('change');
assert.equal(secondStage.hidden, false, 'in-progress filter should show matching tasks');
assert.equal(page.activeStages.get('1').hidden, true, 'active stage list should respect the filter');

const restored = createPage(storage);
assert.equal(restored.items[0].select.value, 'done', 'status should persist after page reload');
assert.equal(restored.items.find(item => item.dataset.roadmapStage === '2').select.value, 'in-progress');

restored.setConfirmation(false);
restored.elements.get('roadmap-reset').dispatch('click');
assert.equal(restored.items[0].select.value, 'done', 'canceling reset should preserve saved status');
restored.setConfirmation(true);
restored.elements.get('roadmap-reset').dispatch('click');
assert.equal(restored.elements.get('roadmap-total-label').textContent, '0 / 32 hotovo · 0 %');
assert.deepEqual(JSON.parse(storage.get('chaindetective.roadmap.state.v1')), {}, 'confirmed reset should clear saved roadmap state');
assert.ok(restored.items.every(item => item.select.value === 'not-started'));

console.log('Roadmap regression checks passed: IDs, progress, filters, persistence, and confirmed reset.');
