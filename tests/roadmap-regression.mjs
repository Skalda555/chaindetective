import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../dist/roadmap.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../dist/roadmap.js', import.meta.url), 'utf8');
new Function(script);

const taskMatches = [...html.matchAll(/data-roadmap-item="([^"]+)" data-roadmap-stage="([1-7])"/g)];
const ids = taskMatches.map(match => match[1]);
assert.equal(ids.length, 32, 'all current implementation points should have a status');
assert.equal(new Set(ids).size, ids.length, 'roadmap task IDs must be unique');
assert.ok(!html.slice(html.indexOf('id="foundation"')).includes('data-roadmap-item='), 'completed foundation stays a historical list');
assert.match(html, /<script src="\.\/roadmap\.js"><\/script>/, 'served roadmap loads its state manager');

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
    this.className = '';
    this.parentElement = null;
    this.classList = { add() {} };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    if (selector === 'select') return this.select ?? null;
    if (selector === '.roadmap-badge') return this.badge ?? null;
    if (selector === 'h3') return this.heading ?? null;
    return null;
  }
  querySelectorAll(selector) { return selector === 'p' ? this.paragraphs ?? [] : []; }
  dispatch(type) { this.listeners[type]?.({ target: this }); }
}

const stageMatches = [...html.matchAll(/<article id="stage-(\d)"[\s\S]*?<\/article>/g)];
const stageModels = stageMatches.map(match => {
  const source = match[0];
  const heading = source.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '';
  const paragraphs = [...source.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)]
    .map(paragraph => paragraph[1].replace(/<[^>]+>/g, '').trim());
  return { stage: match[1], heading, paragraphs };
});

function createPage(storage = new Map(), confirmation = true) {
  const items = taskMatches.map(match => new Element({
    dataset: { roadmapItem: match[1], roadmapStage: match[2] },
    textContent: match[1],
  }));
  const elements = new Map();
  const add = (id, element = new Element({ id })) => (elements.set(id, element), element);
  add('roadmap-total-label');
  add('roadmap-status-filter').value = 'all';
  add('roadmap-reset');
  const totalBar = add('roadmap-total-bar');
  totalBar.parentElement = new Element();
  add('roadmap-footer-status');
  add('now-title');
  add('now-description');
  add('now-tasks');
  add('now-done-definition');
  const now = add('now');
  now.badge = new Element({ textContent: 'PRÁVĚ TEĎ' });

  const stageCards = new Map();
  const stageLabels = new Map();
  for (const model of stageModels) {
    const card = new Element();
    card.badge = new Element();
    card.heading = new Element({ textContent: model.heading.replace(/<[^>]+>/g, '') });
    card.paragraphs = model.paragraphs.map(text => new Element({ textContent: text }));
    stageCards.set(model.stage, card);
    stageLabels.set(model.stage, add('roadmap-stage-' + model.stage + '-label'));
    const bar = add('roadmap-stage-' + model.stage + '-bar');
    bar.parentElement = new Element();
  }
  const document = {
    querySelectorAll: selector => selector === '[data-roadmap-item]' ? items : [],
    getElementById: id => elements.get(id) ?? null,
    querySelector: selector => {
      const card = selector.match(/^\[data-roadmap-stage-card="(\d+)"\]$/);
      if (card) return stageCards.get(card[1]);
      const heading = selector.match(/^\[data-roadmap-stage-card="(\d+)"\] h3$/);
      return heading ? stageCards.get(heading[1])?.heading ?? null : null;
    },
    createElement: () => new Element(),
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const window = { confirm: () => confirmation };
  runInNewContext(script, { document, localStorage, window, Set, Map, JSON, Math, Number });
  for (const item of items) item.select = item.children[0].children[0];
  return {
    items, elements, stageCards, stageLabels, storage,
    setConfirmation: value => { confirmation = value; },
  };
}

const stateKey = 'chaindetective.roadmap.state.v1';
const byStage = stage => taskMatches.filter(match => match[2] === String(stage)).map(match => match[1]);
const savedState = (completedStages = [], partial = {}) => {
  const state = {};
  for (const stage of completedStages) for (const id of byStage(stage)) state[id] = 'done';
  for (const [id, value] of Object.entries(partial)) state[id] = value;
  return new Map([[stateKey, JSON.stringify(state)]]);
};
const activeTitle = page => page.elements.get('now-title').textContent;
const activeControls = page => page.elements.get('now-tasks').children
  .map(row => row.children[1].children[0]);

// A: 7/8 keeps stage 1 current.
const sevenOfEight = savedState([], Object.fromEntries(byStage(1).slice(0, 7).map(id => [id, 'done'])));
const stageOne = createPage(sevenOfEight);
assert.equal(activeTitle(stageOne), 'Etapa 1 · Správnost výsledků a řízení úloh');
assert.equal(stageOne.stageLabels.get('1').textContent, '7 / 8 hotovo · 88 %');

// B: completing stage 1 immediately advances the active panel and relative badges.
const eightOfEight = savedState([1]);
const stageTwo = createPage(eightOfEight);
assert.equal(activeTitle(stageTwo), 'Etapa 2 · Souvislý research workflow');
assert.equal(stageTwo.elements.get('now-tasks').children.length, 5);
assert.equal(activeControls(stageTwo).length, 5, 'each active-stage task has its own status select');
assert.ok(activeControls(stageTwo).every(select =>
  select.children.map(option => option.value).join(',') === 'not-started,in-progress,done'));
assert.ok(activeControls(stageTwo).every(select => select.value === 'not-started'));
assert.equal(stageTwo.elements.get('now-description').textContent, 'Propojit existující obrazovky a zachovat výzkumný kontext při navigaci.');
assert.equal(stageTwo.elements.get('now-done-definition').textContent, 'Hotovo znamená: celý research flow funguje bez kopírování adres a bez ztráty rozpracované analýzy.');
assert.equal(stageTwo.stageLabels.get('1').textContent, '8 / 8 hotovo · 100 %');
assert.equal(stageTwo.stageCards.get('1').badge.textContent, 'DOKONČENO');
assert.equal(stageTwo.stageCards.get('1').badge.className, 'roadmap-badge done');
assert.equal(stageTwo.stageCards.get('2').badge.textContent, 'AKTUÁLNÍ · NEJVYŠŠÍ PRIORITA');
assert.equal(stageTwo.stageCards.get('3').badge.textContent, 'DALŠÍ');
assert.equal(stageTwo.elements.get('roadmap-total-label').textContent, '8 / 32 hotovo · 25 %');

// B/C: active-stage controls share the existing persisted task state and update progress live.
let firstStageTwoControl = activeControls(stageTwo)[0];
firstStageTwoControl.value = 'in-progress';
firstStageTwoControl.dispatch('change');
assert.equal(stageTwo.stageLabels.get('2').textContent, '0 / 5 hotovo · 0 %', 'progress counts completed tasks only');
assert.equal(JSON.parse(stageTwo.storage.get(stateKey))[byStage(2)[0]], 'in-progress');
firstStageTwoControl = activeControls(stageTwo)[0];
firstStageTwoControl.value = 'done';
firstStageTwoControl.dispatch('change');
assert.equal(stageTwo.stageLabels.get('2').textContent, '1 / 5 hotovo · 20 %');
assert.equal(stageTwo.elements.get('roadmap-total-label').textContent, '9 / 32 hotovo · 28 %');
assert.equal(stageTwo.items.find(item => item.dataset.roadmapItem === byStage(2)[0]).select.value, 'done',
  'the stage card select mirrors the active-panel select');

// C: all of stages 1 and 2 plus one task in stage 3 advances to stage 3.
const stageThree = createPage(savedState([1, 2], { [byStage(3)[0]]: 'done' }));
assert.equal(activeTitle(stageThree), 'Etapa 3 · Datový a výkonový základ');

// D: a reload restores saved states before the initial stage calculation.
const reloaded = createPage(new Map([[stateKey, stageTwo.storage.get(stateKey)]]));
assert.equal(activeTitle(reloaded), 'Etapa 2 · Souvislý research workflow');
assert.equal(reloaded.elements.get('roadmap-total-label').textContent, '9 / 32 hotovo · 28 %');
assert.equal(activeControls(reloaded)[0].value, 'done', 'active-panel state survives reload');
assert.equal(reloaded.items.find(item => item.dataset.roadmapItem === byStage(2)[0]).select.value, 'done');

// E: completing the last stage-2 task advances to stage 3 without reload.
for (const item of reloaded.items.filter(item => item.dataset.roadmapStage === '2').slice(1, 4)) {
  item.select.value = 'done';
  item.select.dispatch('change');
}
const finalStageTwoControl = activeControls(reloaded)[4];
finalStageTwoControl.value = 'done';
finalStageTwoControl.dispatch('change');
assert.equal(reloaded.stageLabels.get('2').textContent, '5 / 5 hotovo · 100 %');
assert.equal(reloaded.stageCards.get('2').badge.textContent, 'DOKONČENO');
assert.equal(activeTitle(reloaded), 'Etapa 3 · Datový a výkonový základ');

// F: returning a stage-2 task from done to in-progress derives stage 2 again.
const reversedItem = reloaded.items.find(item => item.dataset.roadmapStage === '2');
reversedItem.select.value = 'in-progress';
reversedItem.select.dispatch('change');
assert.equal(activeTitle(reloaded), 'Etapa 2 · Souvislý research workflow');
assert.equal(reloaded.stageCards.get('2').badge.textContent, 'AKTUÁLNÍ · NEJVYŠŠÍ PRIORITA');
reversedItem.select.value = 'done';
reversedItem.select.dispatch('change');
assert.equal(activeTitle(reloaded), 'Etapa 3 · Datový a výkonový základ');

// F: every task complete renders the terminal roadmap state.
const allDoneState = {};
for (const match of taskMatches) allDoneState[match[1]] = 'done';
const completed = createPage(new Map([[stateKey, JSON.stringify(allDoneState)]]));
assert.equal(activeTitle(completed), 'ROADMAP DOKONČENA');
assert.ok(stageModels.every(model => completed.stageCards.get(model.stage).badge.textContent === 'DOKONČENO'));

console.log('Roadmap regression checks passed: active-stage controls, shared state, live progress, reload, stage transitions, and completion.');
