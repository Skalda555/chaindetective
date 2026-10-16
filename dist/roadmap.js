(() => {
  const KEY = 'chaindetective.roadmap.state.v1';
  const validStates = new Set(['not-started', 'in-progress', 'done']);
  const labels = { 'not-started': 'Nezahájeno', 'in-progress': 'Probíhá', done: 'Hotovo' };
  const items = [...document.querySelectorAll('[data-roadmap-item]')];
  const taskLabels = new Map(items.map(item => [item, item.textContent.trim()]));
  const stages = [...new Set(items.map(item => item.dataset.roadmapStage))]
    .sort((left, right) => Number(left) - Number(right));
  const itemsByStage = new Map(stages.map(stage => [
    stage, items.filter(item => item.dataset.roadmapStage === stage),
  ]));

  // Restore task states before the first render so the active stage is correct on reload.
  let states = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) states = parsed;
  } catch {}

  const safeState = id => validStates.has(states[id]) ? states[id] : 'not-started';
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(states));
      return true;
    } catch {
      return false;
    }
  };
  const statusFilter = document.getElementById('roadmap-status-filter');

  for (const item of items) {
    const id = item.dataset.roadmapItem;
    item.classList.add('roadmap-item');
    const label = document.createElement('label');
    label.className = 'roadmap-item-status';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Stav úkolu: ' + taskLabels.get(item));
    for (const value of ['not-started', 'in-progress', 'done']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labels[value];
      select.append(option);
    }
    select.value = safeState(id);
    select.addEventListener('change', () => {
      states[id] = select.value;
      save();
      render();
    });
    label.append(select);
    item.append(label);
  }

  const render = () => {
    const filter = statusFilter.value;
    for (const item of items) {
      item.hidden = filter !== 'all' && safeState(item.dataset.roadmapItem) !== filter;
      const select = item.querySelector('select');
      if (select) select.value = safeState(item.dataset.roadmapItem);
    }

    const stageProgress = new Map();
    for (const stage of stages) {
      const stageItems = itemsByStage.get(stage);
      const done = stageItems.filter(item => safeState(item.dataset.roadmapItem) === 'done').length;
      const complete = stageItems.length > 0 && done === stageItems.length;
      const percent = stageItems.length ? Math.round(done / stageItems.length * 100) : 0;
      stageProgress.set(stage, { done, total: stageItems.length, complete, percent });

      const label = document.getElementById('roadmap-stage-' + stage + '-label');
      const bar = document.getElementById('roadmap-stage-' + stage + '-bar');
      if (label) label.textContent = done + ' / ' + stageItems.length + ' hotovo · ' + percent + ' %';
      if (bar) {
        bar.style.width = percent + '%';
        bar.parentElement.setAttribute('aria-valuenow', String(percent));
      }

      const card = document.querySelector('[data-roadmap-stage-card="' + stage + '"]');
      if (card) {
        card.hidden = filter !== 'all'
          && !stageItems.some(item => safeState(item.dataset.roadmapItem) === filter);
      }
    }

    // The first incomplete stage is the only source of truth for "current".
    const currentStage = stages.find(stage => !stageProgress.get(stage).complete) ?? null;
    const currentIndex = currentStage === null ? -1 : stages.indexOf(currentStage);
    const currentItems = currentStage === null ? [] : itemsByStage.get(currentStage);
    const now = document.getElementById('now');
    const nowTitle = document.getElementById('now-title');
    const nowDescription = document.getElementById('now-description');
    const nowTasks = document.getElementById('now-tasks');
    const nowDoneDefinition = document.getElementById('now-done-definition');

    if (currentStage === null) {
      nowTitle.textContent = 'ROADMAP DOKONČENA';
      nowDescription.textContent = 'Všechny etapy jsou dokončené.';
      nowTasks.replaceChildren();
      nowDoneDefinition.hidden = true;
    } else {
      const card = document.querySelector('[data-roadmap-stage-card="' + currentStage + '"]');
      const title = card.querySelector('h3').textContent.trim();
      const paragraphs = [...card.querySelectorAll('p')];
      nowTitle.textContent = title;
      nowDescription.textContent = paragraphs[0].textContent.trim();
      nowTasks.replaceChildren(...currentItems.map(item => {
        const task = document.createElement('li');
        task.className = 'roadmap-item roadmap-active-task';
        const taskText = document.createElement('span');
        taskText.className = 'roadmap-task-label';
        taskText.textContent = taskLabels.get(item);
        const label = document.createElement('label');
        label.className = 'roadmap-item-status';
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Stav úkolu: ' + taskLabels.get(item));
        for (const value of ['not-started', 'in-progress', 'done']) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = labels[value];
          select.append(option);
        }
        select.value = safeState(item.dataset.roadmapItem);
        select.addEventListener('change', () => {
          states[item.dataset.roadmapItem] = select.value;
          save();
          render();
        });
        label.append(select);
        task.append(taskText, label);
        return task;
      }));
      nowDoneDefinition.hidden = false;
      nowDoneDefinition.textContent = paragraphs[paragraphs.length - 1].textContent.trim();
    }

    const nowBadge = now.querySelector('.roadmap-badge');
    nowBadge.textContent = currentStage === null ? 'DOKONČENO' : 'PRÁVĚ TEĎ';
    now.hidden = currentStage !== null && filter !== 'all'
      && !currentItems.some(item => safeState(item.dataset.roadmapItem) === filter);

    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index];
      const card = document.querySelector('[data-roadmap-stage-card="' + stage + '"]');
      const badge = card.querySelector('.roadmap-badge');
      const progress = stageProgress.get(stage);
      if (progress.complete) {
        badge.textContent = 'DOKONČENO';
        badge.className = 'roadmap-badge done';
      } else if (index === currentIndex) {
        badge.textContent = 'AKTUÁLNÍ · NEJVYŠŠÍ PRIORITA';
        badge.className = 'roadmap-badge next';
      } else if (index === currentIndex + 1) {
        badge.textContent = 'DALŠÍ';
        badge.className = 'roadmap-badge';
      } else if (index === currentIndex + 2) {
        badge.textContent = 'NÁSLEDNĚ';
        badge.className = 'roadmap-badge';
      } else {
        badge.textContent = 'POZDĚJI';
        badge.className = 'roadmap-badge';
      }
    }

    const done = items.filter(item => safeState(item.dataset.roadmapItem) === 'done').length;
    const percent = items.length ? Math.round(done / items.length * 100) : 0;
    document.getElementById('roadmap-total-label').textContent =
      done + ' / ' + items.length + ' hotovo · ' + percent + ' %';
    const totalBar = document.getElementById('roadmap-total-bar');
    totalBar.style.width = percent + '%';
    totalBar.parentElement.setAttribute('aria-valuenow', String(percent));
    const footerStatus = currentStage === null
      ? 'ChainDetective · ROADMAP DOKONČENA'
      : 'ChainDetective · Aktuálně '
        + document.querySelector('[data-roadmap-stage-card="' + currentStage + '"] h3').textContent.trim();
    document.getElementById('roadmap-footer-status').textContent = footerStatus;
  };

  statusFilter.addEventListener('change', render);
  document.getElementById('roadmap-reset').addEventListener('click', () => {
    if (!window.confirm('Opravdu resetovat všechny stavy roadmapy na „Nezahájeno“?')) return;
    states = {};
    save();
    for (const item of items) item.querySelector('select').value = 'not-started';
    render();
  });
  render();
})();
