(() => {
  const statusLabels = {
    'not-started': 'NEZAHÁJENO',
    'in-progress': 'PROBÍHÁ',
    done: 'HOTOVO',
  };
  const statusFilter = document.getElementById('roadmap-status-filter');
  const dataError = document.getElementById('roadmap-data-error');

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const renderTask = (task, { includeDetails = true } = {}) => {
    const row = make('li', 'roadmap-item');
    row.dataset.roadmapItem = task.id;
    row.dataset.roadmapStatus = task.status;

    const main = make('div', 'roadmap-task-main');
    const status = make('span', 'roadmap-task-status', statusLabels[task.status]);
    status.dataset.status = task.status;
    main.append(make('span', 'roadmap-task-label', task.title), status);

    if (!includeDetails) {
      row.classList.add('roadmap-active-task');
      row.append(main);
      return row;
    }

    const disclosure = make('details', 'roadmap-task-disclosure');
    const summary = make('summary', 'roadmap-task-summary');
    summary.append(main);
    disclosure.append(summary);

    const detail = make('div', 'roadmap-task-detail');
    detail.append(make('code', 'roadmap-task-id', task.id));
    detail.append(make('p', '', task.description));
    const criteria = make('ul', '');
    for (const criterion of task.acceptance_criteria) criteria.append(make('li', '', criterion));
    detail.append(criteria);

    const evidence = [];
    const taskEvidence = task.evidence ?? {};
    if (task.dependencies.length) evidence.push('Závislosti: ' + task.dependencies.join(', '));
    if (taskEvidence.verified) evidence.push('Ověřeno');
    if (taskEvidence.tests?.length) evidence.push('Testy: ' + taskEvidence.tests.join(', '));
    if (taskEvidence.completed_at) evidence.push('Dokončeno: ' + new Date(taskEvidence.completed_at).toLocaleDateString('cs-CZ'));
    if (evidence.length) detail.append(make('p', 'roadmap-task-evidence', evidence.join(' · ')));
    if (taskEvidence.notes) detail.append(make('p', '', taskEvidence.notes));
    disclosure.append(detail);
    row.append(disclosure);
    return row;
  };

  const initialize = async () => {
    try {
      const embeddedData = document.getElementById('roadmap-canonical-data');
      let data;
      if (embeddedData) {
        data = JSON.parse(embeddedData.textContent);
      } else {
        const response = await fetch('./roadmap-data.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        data = await response.json();
      }
      const phases = data.phases;
      const tasks = data.tasks;
      if (!Array.isArray(phases) || !Array.isArray(tasks)) throw new Error('Neplatná struktura roadmapy.');

      const tasksByPhase = new Map(phases.map(phase => [phase.id, []]));
      for (const task of tasks) {
        if (!tasksByPhase.has(task.phase_id)) throw new Error('Úkol odkazuje na neznámou etapu: ' + task.id);
        tasksByPhase.get(task.phase_id).push(task);
      }

      const phaseCards = new Map();
      for (const phase of phases) {
        const card = document.querySelector('[data-roadmap-stage-card="' + phase.number + '"]');
        const taskList = card?.querySelector('[data-roadmap-stage-tasks]');
        if (!card || !taskList) throw new Error('HTML neobsahuje kartu nebo seznam pro ' + phase.id);
        phaseCards.set(phase.id, card);
        card.querySelector('h3').textContent = phase.title;
        const paragraphs = card.querySelectorAll('p');
        if (paragraphs[0]) paragraphs[0].textContent = phase.description;
        const doneDefinition = paragraphs[paragraphs.length - 1];
        if (doneDefinition) {
          const lead = make('strong', '', 'Hotovo znamená: ');
          doneDefinition.replaceChildren(lead, document.createTextNode(phase.done_definition));
        }
        taskList.replaceChildren(...tasksByPhase.get(phase.id).map(renderTask));
      }

      const allRows = [...document.querySelectorAll('[data-roadmap-item]')];
      const rowById = new Map(allRows.map(row => [row.dataset.roadmapItem, row]));
      const statusOf = task => task.status;
      const now = document.getElementById('now');
      const nowTitle = document.getElementById('now-title');
      const nowDescription = document.getElementById('now-description');
      const nowTasks = document.getElementById('now-tasks');
      const totalBar = document.getElementById('roadmap-total-bar');

      const render = () => {
        const filter = statusFilter.value;
        for (const task of tasks) rowById.get(task.id).hidden = filter !== 'all' && task.status !== filter;

        const progress = new Map();
        for (const phase of phases) {
          const phaseTasks = tasksByPhase.get(phase.id);
          const done = phaseTasks.filter(task => statusOf(task) === 'done').length;
          const complete = phaseTasks.length > 0 && done === phaseTasks.length;
          const percent = phaseTasks.length ? Math.round(done / phaseTasks.length * 100) : 0;
          progress.set(phase.id, { done, total: phaseTasks.length, complete, percent });
          const label = document.getElementById('roadmap-stage-' + phase.number + '-label');
          const bar = document.getElementById('roadmap-stage-' + phase.number + '-bar');
          if (label) label.textContent = done + ' / ' + phaseTasks.length + ' hotovo · ' + percent + ' %';
          if (bar) {
            bar.style.width = percent + '%';
            bar.parentElement.setAttribute('aria-valuenow', String(percent));
          }
          const card = phaseCards.get(phase.id);
          card.hidden = filter !== 'all' && !phaseTasks.some(task => task.status === filter);
        }

        const currentPhase = phases.find(phase => !progress.get(phase.id).complete) ?? null;
        const currentTasks = currentPhase ? tasksByPhase.get(currentPhase.id) : [];
        if (!currentPhase) {
          nowTitle.textContent = 'ROADMAP DOKONČENA';
          nowDescription.textContent = 'Všechny etapy jsou dokončené.';
          nowTasks.replaceChildren();
        } else {
          nowTitle.textContent = currentPhase.title;
          nowDescription.textContent = currentPhase.description;
          nowTasks.replaceChildren(...currentTasks.map(task => {
            const item = renderTask(task, { includeDetails: false });
            item.hidden = filter !== 'all' && task.status !== filter;
            return item;
          }));
        }
        const nowBadge = now.querySelector('.roadmap-badge');
        nowBadge.textContent = currentPhase ? 'PRÁVĚ TEĎ' : 'DOKONČENO';
        now.hidden = Boolean(currentPhase && filter !== 'all' && !currentTasks.some(task => task.status === filter));

        const currentIndex = currentPhase ? phases.indexOf(currentPhase) : -1;
        phases.forEach((phase, index) => {
          const badge = phaseCards.get(phase.id).querySelector('.roadmap-badge');
          if (progress.get(phase.id).complete) {
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
        });

        const done = tasks.filter(task => statusOf(task) === 'done').length;
        const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
        document.getElementById('roadmap-total-label').textContent = done + ' / ' + tasks.length + ' hotovo · ' + percent + ' %';
        totalBar.style.width = percent + '%';
        totalBar.parentElement.setAttribute('aria-valuenow', String(percent));
        document.getElementById('roadmap-footer-status').textContent = currentPhase
          ? 'ChainDetective · Aktuálně ' + currentPhase.title
          : 'ChainDetective · ROADMAP DOKONČENA';
      };

      statusFilter.addEventListener('change', render);
      render();
    } catch (error) {
      dataError.hidden = false;
      dataError.textContent = 'Repository roadmapu se nepodařilo načíst: ' + error.message;
    }
  };

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
