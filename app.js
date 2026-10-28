/**
 * Meridian SRE dashboard - interface layer.
 *
 * Reads three globals created by the other scripts:
 *   SEED         (src/data.js)         services, SLOs, incidents, runbooks, postmortems
 *   DEPLOYMENTS  (src/deployments.js)  deployment log for the DORA tab
 *   Logic        (src/logic.js)        every calculation. This file only renders results.
 *
 * Sections: 1 helpers, 2 state, 3 shared components, 4 Incidents tab, 5 DORA tab,
 *           6 Error budgets tab, 7 render, 8 event handlers.
 *
 * The whole page is re-rendered from `state` after every action (see render()).
 * Buttons describe what they do with data attributes: data-a is the action name
 * (a key of `actions` in section 8) and data-v is its value.
 */
(function () {
  'use strict';

  // ---------- 1. Helpers ----------

  /** Escape text before putting it into an HTML string. Use it on everything from the data. */
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const oneDecimal = (n) => n.toFixed(1);

  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const TEMPLATE_PATH = 'templates/blameless-postmortem-template.docx';

  /** Link to the blank postmortem template: the copy embedded by the build, else the file. */
  const templateHref = () =>
    typeof TEMPLATE_B64 !== 'undefined'
      ? `data:${DOCX_MIME};base64,${TEMPLATE_B64}`
      : TEMPLATE_PATH;

  /** Smooth scrolling for deliberate moves, unless the user prefers reduced motion. */
  const scrollBehavior = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  const scrollToElement = (el) =>
    el && el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });

  // ---------- 2. State ----------

  const STORAGE_KEY = 'meridian-sre';
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    // Storage can be blocked (for example in a sandboxed preview). Start with defaults.
  }

  const state = {
    tab: 'incidents', // 'incidents' | 'dora' | 'budgets'
    selectedId: 'INC-1', // incident shown in the investigation panel
    logLevel: 'ALL',
    logQuery: '',
    selectedLog: null, // index of the log entry open in the detail pane
    postmortemOpenFor: null, // incident id whose postmortem starter is expanded
    viewer: null, // { title, text } for the read-only postmortem viewer
    checked: stored.checked || {}, // runbook checklist progress, the only saved state
  };

  const saveChecklist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ checked: state.checked }));
    } catch (e) {
      // Not saving is acceptable: progress simply resets on reload.
    }
  };

  /** Incidents with their status detected from data (Active until a restore time exists). */
  const getIncidents = () => SEED.incidents.map((i) => ({ ...i, status: Logic.status(i) }));
  const summarizeBudgets = (incidents) => Logic.summarize({ ...SEED, incidents });

  // ---------- 3. Shared components ----------

  const PILL_ICONS = { crit: '▲', warn: '◆', ok: '●', acc: '◆' };

  /** A status label. Always pairs color with an icon and text so color is never the only cue. */
  function pill(text, tone, extraClass = '', tooltip = '') {
    const title = tooltip ? `title="${escapeHtml(tooltip)}"` : '';
    return `<span class="pill ${tone} ${extraClass}" ${title}>${PILL_ICONS[tone]} ${escapeHtml(text)}</span>`;
  }

  const incidentTone = (status) => (status === 'Active' ? 'crit' : 'ok');
  const BUDGET_TONES = { Exhausted: 'crit', 'At risk': 'warn', Healthy: 'ok' };
  const RATING_TONES = { Elite: 'ok', High: 'acc', Medium: 'warn', Low: 'crit' };
  const isFiring = (incident) => Boolean(incident.alert && /Firing/.test(incident.alert.state));

  /** Button that opens an incident in the investigation panel. */
  const openIncidentButton = (id, label = id, primary = false) =>
    `<button ${primary ? 'class="p" ' : ''}data-a="open" data-v="${id}">${label}</button>`;

  /** Button that copies the text of the element with id `targetId`. */
  const copyButton = (targetId, label, ariaLabel = '') =>
    `<button data-a="copy" data-t="${targetId}"${ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : ''}>${label}</button>`;

  const TABS = [
    ['incidents', 'Incidents'],
    ['dora', 'DORA logs'],
    ['budgets', 'Error budgets'],
  ];
  const tabBar = () =>
    `<div class="tabs" role="tablist" aria-label="Dashboard sections">${TABS.map(
      ([id, label]) =>
        `<button role="tab" aria-selected="${state.tab === id}" data-a="tab" data-v="${id}">${label}</button>`
    ).join('')}</div>`;

  // ---------- 4. Incidents tab ----------

  function overviewTiles(incidents, summaries) {
    const active = incidents.filter(Logic.isActive);
    const firing = active.filter(isFiring).length;
    const atRisk = summaries.filter((s) => s.status !== 'Healthy').length;
    const noAlertNote = active.length && !firing ? 'Active incidents have no firing alert' : '';
    return `<section aria-label="Overview"><div class="grid">
      <div><div class="mut">Overall health</div><div class="big">${active.length ? pill('Degraded', 'crit') : pill('Healthy', 'ok')}</div></div>
      <div><div class="mut">Active incidents</div><div class="big">${active.length}</div></div>
      <div><div class="mut">Alerts firing</div><div class="big">${firing}</div><div class="mut">${noAlertNote}</div></div>
      <div><div class="mut">SLOs at risk or exhausted</div><div class="big">${atRisk} of ${summaries.length}</div></div>
      <div><div class="mut">Data</div><div>Simulated seed data, no live feed</div></div></div></section>`;
  }

  function incidentRow(incident) {
    const keyMetric = incident.metrics[0];
    const alertCell = incident.alert
      ? (isFiring(incident) ? pill('Firing', 'crit') + ' ' : '') + escapeHtml(incident.alert.name)
      : 'None recorded';
    const ongoing = incident.status === 'Active' ? ' (ongoing)' : '';
    const selected = incident.id === state.selectedId ? 'sel ' : '';
    return `<tr class="${selected}${incident.status.toLowerCase()}">
      <td>${pill(incident.status, incidentTone(incident.status), 'st')}</td>
      <td><b>${incident.id}</b> ${escapeHtml(incident.title)}<div class="mut">${escapeHtml(incident.service)}</div></td>
      <td>${pill(incident.sev, incident.sev === 'SEV-1' ? 'crit' : 'warn')}</td>
      <td>${incident.durationMin} min${ongoing}</td>
      <td>${incident.sli}</td>
      <td>${escapeHtml(keyMetric.name)}: ${keyMetric.value}${keyMetric.unit}</td>
      <td>${alertCell}</td>
      <td>${openIncidentButton(incident.id, 'Open', true)}</td></tr>`;
  }

  function incidentsTable(incidents) {
    const activeFirst = [...incidents].sort((a, b) => Logic.isActive(b) - Logic.isActive(a));
    return `<h2>Incidents in the last 7 days</h2><section><table><thead><tr><th>Status</th><th>Incident</th><th>Severity</th><th>Duration</th><th>SLI</th><th>Key metric</th><th>Alert</th><th></th></tr></thead>
      <tbody>${activeFirst.map(incidentRow).join('')}</tbody></table></section>`;
  }

  /** Start-a-postmortem card. Only offered once the incident is Resolved (system restored). */
  function postmortemCard(incident, summaries) {
    const header = `<section><div class="row">${pill(incident.status, incidentTone(incident.status), 'st')}<span class="mut">${escapeHtml(incident.id)}</span></div>`;
    if (incident.status !== 'Resolved') {
      return `${header}<div class="mut">A postmortem can start once the system is restored. No restoration is recorded yet.</div></section>`;
    }
    const draft = Logic.draftStart(incident, summaries);
    const isOpen = state.postmortemOpenFor === incident.id;
    const draftCard = isOpen
      ? `<div class="card"><h3>Summary</h3><p id="pm-sum">${escapeHtml(draft.summary)}</p>${copyButton('pm-sum', 'Copy summary')}
      <h3>Impact</h3><ul id="pm-imp">${draft.impact.map((x) => `<li><b>${x.label}:</b> ${escapeHtml(x.text)}</li>`).join('')}</ul>${copyButton('pm-imp', 'Copy impact')}
      <h3>Blank template</h3><a class="btn" download="blameless-postmortem-template.docx" href="${templateHref()}">Download blank postmortem template (.docx)</a></div>`
      : '';
    return `${header}<h3>Start blameless postmortem with AI</h3><div class="mut">Drafted by local rules from this incident's data. No external AI model is called.</div>
      <div class="row"><button class="p" data-a="pmopen">${isOpen ? 'Hide draft' : 'Start blameless postmortem'}</button></div>${draftCard}</section>`;
  }

  function metricsTable(incident) {
    const rows = incident.metrics.map((m) => {
      const target = m.limit == null ? '-' : `under ${m.limit}${m.unit}`;
      const verdict =
        m.limit == null
          ? '-'
          : m.value <= m.limit
            ? pill('Within target', 'ok')
            : pill('Breaching', 'crit');
      return `<tr><td>${escapeHtml(m.name)}</td><td>${m.value}${m.unit}</td><td>${target}</td><td>${verdict}</td></tr>`;
    });
    return `<table><thead><tr><th>Metric</th><th>Now</th><th>Target</th><th>State</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function alertBlock(incident) {
    if (!incident.alert) return '<p>No alert is recorded for this incident.</p>';
    const { name, rule, state: alertState } = incident.alert;
    return `<p><b>${escapeHtml(name)}</b>: ${escapeHtml(rule)}<br>State: ${escapeHtml(alertState)}</p>`;
  }

  /** Metrics, alert, detection method, and timeline for one incident. */
  function evidencePanel(incident) {
    const detection = incident.detection
      ? escapeHtml(incident.detection)
      : 'Unknown - requires human review.';
    const timeline = incident.timeline.map(
      ([time, event]) => `<li>${time} ${escapeHtml(event)}</li>`
    );
    return `<section><h3>Metrics</h3>${metricsTable(incident)}
      <h3>Alert</h3>${alertBlock(incident)}
      <h3>Detection</h3><p>${detection}</p>
      <h3>Timeline</h3><ul>${timeline.join('')}</ul></section>`;
  }

  /** Log filter controls. The log rows are filled in separately by renderLogs(). */
  function logsPanel() {
    const options = ['ALL', 'ERROR', 'WARN', 'INFO']
      .map((level) => `<option ${level === state.logLevel ? 'selected' : ''}>${level}</option>`)
      .join('');
    return `<section><h3>Logs (synthetic)</h3><div class="row"><select id="lvl" aria-label="Severity">${options}</select>
      <input id="q" type="search" placeholder="Search messages" aria-label="Search logs" value="${escapeHtml(state.logQuery)}"></div><div id="logs"></div></section>`;
  }

  /** Table of who to call. Active incidents highlight the people to contact right now. */
  function escalationTable(incident, runbook) {
    const contacts = Logic.isActive(incident) ? incident.contact || [] : [];
    const rows = runbook.escalation.map((person, k) => {
      const contact = contacts.find((c) => c.role === person.role);
      const roleExtra = contact ? `<div>${pill('Contact now', 'warn')}</div>` : '';
      const whyExtra = contact ? `<div><b>Why:</b> ${escapeHtml(contact.why)}</div>` : '';
      return `<tr class="${contact ? 'contact' : ''}"><td>${escapeHtml(person.level)}</td><td>${escapeHtml(person.role)}${roleExtra}</td><td>${escapeHtml(person.when)}${whyExtra}</td>
        <td><span id="ec-${k}-n">${escapeHtml(person.name)}</span> ${copyButton(`ec-${k}-n`, 'Copy', `Copy name of ${person.name}`)}</td>
        <td><span id="ec-${k}-e">${escapeHtml(person.email)}</span> ${copyButton(`ec-${k}-e`, 'Copy', `Copy email of ${person.name}`)}</td></tr>`;
    });
    const hint = contacts.length ? ' Highlighted rows are who to contact for this incident.' : '';
    return `<h3>Escalation</h3><div class="mut">Names and email addresses are fake, for demonstration.${hint}</div>
      <table><thead><tr><th>Level</th><th>Role</th><th>When</th><th>Name</th><th>Email</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  /** The runbook matching the incident's service, or an honest "none exists" message. */
  function runbookPanel(incident) {
    const runbook = incident.runbook && SEED.runbooks[incident.runbook];
    if (!runbook) {
      return `<section><h3>Runbook</h3><p>No runbook is registered for ${escapeHtml(incident.service)}. Proposed action: write one after this incident.</p></section>`;
    }
    const thresholds = runbook.thresholds.map(
      ([alert, threshold, action]) =>
        `<tr><td>${alert}</td><td>${threshold}</td><td>${action}</td></tr>`
    );
    const steps = runbook.steps.map((step, k) => {
      const key = `${incident.id}:${k}`;
      return `<div><label><input type="checkbox" data-ck="${key}" ${state.checked[key] ? 'checked' : ''}> ${k + 1}. ${escapeHtml(step)}</label></div>`;
    });
    return `<section><h3>Runbook</h3><b>${escapeHtml(runbook.title)}</b> <span class="mut">(${escapeHtml(runbook.service)})</span>
      <table><thead><tr><th>Alert</th><th>Threshold</th><th>Action</th></tr></thead><tbody>${thresholds.join('')}</tbody></table>
      <h3>First response</h3>${steps.join('')}
      ${escalationTable(incident, runbook)}</section>`;
  }

  /** The incident's own postmortem plus others matched by shared tags (see Logic.related). */
  function relatedPostmortems(incident) {
    const own = SEED.postmortems.filter((p) => p.incident === incident.id);
    const related = Logic.related(incident, SEED.postmortems);
    const ownHtml = own.map(
      (p) =>
        `<p><b>${p.id}</b> is the postmortem for this incident. <button data-a="viewpm" data-v="${p.id}">Open</button></p>`
    );
    const relatedHtml = related.map(
      (
        r
      ) => `<div class="card"><b>${r.pm.id}</b> ${escapeHtml(r.pm.title)} <span class="mut">${r.pm.date}, ${escapeHtml(r.pm.service)}</span>
        <p><b>Observed:</b> ${escapeHtml(r.observed.join('; '))}.<br><b>Inferred (unconfirmed):</b> ${escapeHtml(r.inferred.join('; '))}.<br><span class="mut">${escapeHtml(r.caveat)} Summary produced by local rules, not an AI model.</span></p>
        <button data-a="viewpm" data-v="${r.pm.id}">Open</button></div>`
    );
    const none = related.length ? '' : '<p>No other postmortems match this incident.</p>';
    return `<section><h3>Related postmortems</h3>${ownHtml.join('')}${relatedHtml.join('')}${none}</section>`;
  }

  /** Everything about the selected incident, in the order an on-call engineer needs it. */
  function investigation(incident, summaries) {
    return `<h2 id="detail">${incident.id}: ${escapeHtml(incident.title)}</h2>${postmortemCard(incident, summaries)}
      <div class="grid two">${evidencePanel(incident)}${logsPanel()}</div>
      ${runbookPanel(incident)}${relatedPostmortems(incident)}`;
  }

  /** Fill the log table. Runs after render() because the filters re-draw only this part. */
  function renderLogs(incident) {
    const el = document.getElementById('logs');
    if (!el || !incident) return;
    const query = state.logQuery.toLowerCase();
    const rows = incident.logs.filter(
      (log) =>
        (state.logLevel === 'ALL' || log.level === state.logLevel) &&
        log.msg.toLowerCase().includes(query)
    );
    if (!rows.length) {
      el.innerHTML = '<p>No log entries match these filters.</p>';
      return;
    }
    const body = rows.map((log) => {
      const index = incident.logs.indexOf(log);
      return `<tr class="${state.selectedLog === index ? 'sel' : ''}"><td>${log.ts}</td><td>${log.level}</td>
        <td><button data-a="log" data-v="${index}">${escapeHtml(log.service)}</button></td><td>${escapeHtml(log.msg)}</td></tr>`;
    });
    el.innerHTML = `<table class="log"><tbody>${body.join('')}</tbody></table>`;
    const selected = incident.logs[state.selectedLog];
    if (selected) {
      const json = JSON.stringify({ incident: incident.id, ...selected }, null, 2);
      el.innerHTML += `<pre class="log card">${escapeHtml(json)}</pre>`;
    }
  }

  const postmortemList = () =>
    SEED.postmortems
      .map(
        (p) =>
          `<div>${p.id} ${escapeHtml(p.title)} (${p.date}) <button data-a="viewpm" data-v="${p.id}">Open</button></div>`
      )
      .join('');

  const postmortemViewer = () =>
    state.viewer
      ? `<section id="draft"><h3>${escapeHtml(state.viewer.title)}</h3><textarea readonly aria-label="Postmortem text">${escapeHtml(state.viewer.text)}</textarea>
        <div class="row"><button data-a="close">Close</button></div></section>`
      : '';

  function incidentsTab(incidents, summaries) {
    const selected = incidents.find((i) => i.id === state.selectedId);
    return `${overviewTiles(incidents, summaries)}${incidentsTable(incidents)}
      ${selected ? investigation(selected, summaries) : ''}
      <h2>Postmortems</h2><section id="pms">${postmortemList()}</section>${postmortemViewer()}`;
  }

  // ---------- 5. DORA tab ----------

  /**
   * Bar chart as inline SVG (no charting library). Null values leave a gap.
   * `values` and `labels` line up by index; `title` is the accessible description.
   */
  function chart(values, labels, title) {
    const W = 520,
      H = 200; // overall size
    const marginLeft = 46,
      marginRight = 8,
      marginTop = 10,
      marginBottom = 28;
    const plotHeight = H - marginTop - marginBottom;
    const barSlot = (W - marginLeft - marginRight) / values.length;
    const labelEvery = Math.ceil(values.length / 8); // keep x labels readable

    // Round the top of the y axis up to 1, 2, 5, or 10 times a power of ten.
    const largest = Math.max(...values.filter((v) => v != null), 1);
    const magnitude = 10 ** Math.floor(Math.log10(largest));
    const axisMax = [1, 2, 5, 10].find((k) => k >= largest / magnitude) * magnitude;

    const gridLines = [0, axisMax / 2, axisMax].map((tick) => {
      const y = marginTop + plotHeight - (tick / axisMax) * plotHeight;
      return `<line x1="${marginLeft}" x2="${W - marginRight}" y1="${y}" y2="${y}" stroke="var(--line)"/>
        <text x="${marginLeft - 6}" y="${y + 4}" text-anchor="end" style="fill:var(--mut);font-size:11px">${+tick.toFixed(1)}</text>`;
    });
    const bars = values.map((value, i) => {
      const height = value == null ? 0 : (value / axisMax) * plotHeight;
      const x = marginLeft + i * barSlot;
      const bar = `<rect x="${x + barSlot * 0.15}" y="${marginTop + plotHeight - height}" width="${barSlot * 0.7}" height="${height}" rx="2" style="fill:var(--acc)"/>`;
      const label =
        i % labelEvery === 0
          ? `<text x="${x + barSlot / 2}" y="${H - 8}" text-anchor="middle" style="fill:var(--mut);font-size:10.5px">${escapeHtml(labels[i])}</text>`
          : '';
      return bar + label;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)}" style="width:100%;height:auto"><title>${escapeHtml(title)}</title>${gridLines.join('')}${bars.join('')}</svg>`;
  }

  /** One DORA metric: heading with its rating, headline number, chart, and the rating bands. */
  function doraCard({ title, headline, note, svg, metric, value }) {
    const rating = Logic.rate(metric, value);
    const bands = Logic.BANDS[metric].text;
    return `<section><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><h3 style="margin:0">${title}</h3>${pill(rating, RATING_TONES[rating], '', `Rating bands - ${bands}`)}</div>
      <div class="big">${headline}</div><div class="mut">${note}</div>${svg}<div class="mut">Rating bands. ${bands}</div></section>`;
  }

  function deploymentRow(d) {
    const incidentCell = d.incident_id ? openIncidentButton(d.incident_id) : '-';
    return `<tr><td>${escapeHtml(d.id)}</td><td>${escapeHtml(d.deploy_time.replace('T', ' '))}</td><td>${oneDecimal(d.lead_time_minutes)}</td>
      <td>${pill(d.failed ? 'Failed' : 'Succeeded', d.failed ? 'crit' : 'ok')}</td>
      <td>${d.failure_cause ? escapeHtml(d.failure_cause.replace(/_/g, ' ')) : '-'}</td>
      <td>${d.recovery_minutes != null ? oneDecimal(d.recovery_minutes) : '-'}</td><td>${incidentCell}</td></tr>`;
  }

  function doraTab() {
    if (typeof DEPLOYMENTS === 'undefined' || !DEPLOYMENTS.length) {
      return '<h2>DORA logs</h2><section>No deployment data is loaded. Run <code>npm run data</code> and then <code>npm run build</code>.</section>';
    }
    const weeks = Logic.weekly(DEPLOYMENTS);
    const weekLabels = weeks.map((w) => w.week.slice(5)); // MM-DD
    const metrics = Logic.dora(DEPLOYMENTS);
    const failures = DEPLOYMENTS.filter((d) => d.failed);
    const dates = DEPLOYMENTS.map((d) => d.deploy_time).sort();

    const cards = [
      {
        title: 'Deployment frequency',
        headline: `${oneDecimal(metrics.dfPerWeek)} per week`,
        note: 'Deployments per week.',
        svg: chart(
          weeks.map((w) => w.count),
          weekLabels,
          'Deployments per week'
        ),
        metric: 'df',
        value: metrics.dfPerWeek / 7, // the rating bands are per day
      },
      {
        title: 'Lead time for changes',
        headline: `${oneDecimal(metrics.medianLeadMin / 60)} hours median`,
        note: 'Weekly median hours from commit to production. Median, because a few slow changes skew the average.',
        svg: chart(
          weeks.map((w) => (w.medianLeadMin == null ? null : w.medianLeadMin / 60)),
          weekLabels,
          'Median lead time in hours per week'
        ),
        metric: 'lead',
        value: metrics.medianLeadMin,
      },
      {
        title: 'Change failure rate',
        headline: `${oneDecimal(metrics.cfr * 100)}% (${metrics.failed} of ${metrics.total})`,
        note: "Percent of each week's deployments that failed. Elite teams stay under 5%; above 15% signals systemic problems.",
        svg: chart(
          weeks.map((w) => (w.cfr == null ? null : w.cfr * 100)),
          weekLabels,
          'Change failure rate percent per week'
        ),
        metric: 'cfr',
        value: metrics.cfr,
      },
      {
        title: 'Mean time to restore',
        headline: `${oneDecimal(metrics.mttrMin)} min mean`,
        note: `Minutes to recover from each failed deployment. INC-1 and INC-2 are two of the ${metrics.failed} failures.`,
        svg: chart(
          failures.map((d) => d.recovery_minutes),
          failures.map((d) => d.id),
          'Recovery minutes per failed deployment'
        ),
        metric: 'mttr',
        value: metrics.mttrMin,
      },
    ];

    return `<h2>DORA metrics</h2><div class="mut">Synthetic deployment log: ${DEPLOYMENTS.length} deployments from ${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)} (deployments_SYNTHETIC.csv), dated to match the Meridian incidents: INC-1 and INC-2 appear as failed deployments below. Weeks start on Monday, UTC; the last week may be partial.</div>
      <div class="grid two" style="margin-top:12px">${cards.map(doraCard).join('')}</div>
      <h2>30 most recent deployments</h2><section><table><thead><tr><th>Deployment</th><th>Deployed (UTC)</th><th>Lead time (min)</th><th>Result</th><th>Failure cause</th><th>Recovery (min)</th><th>Incident</th></tr></thead>
      <tbody>${Logic.recent(DEPLOYMENTS, 30).map(deploymentRow).join('')}</tbody></table></section>`;
  }

  // ---------- 6. Error budgets tab ----------

  function budgetCard(s) {
    const tone = BUDGET_TONES[s.status];
    const remaining =
      s.remaining >= 0
        ? `Remaining ${oneDecimal(s.remaining)} min (${oneDecimal(100 - s.pct * 100)}%).`
        : `Over budget by ${oneDecimal(-s.remaining)} min.`;
    const rows = s.rows.map(
      (r) =>
        `<tr><td>${openIncidentButton(r.id)} ${escapeHtml(r.title)}</td><td>${r.start.slice(0, 10)}</td><td>${r.durationMin} min</td><td>${Math.round(r.badShare * 100)}%</td><td>${oneDecimal(r.consumed)} min</td></tr>`
    );
    return `<section><b>${escapeHtml(s.service)}: ${escapeHtml(s.name)}</b> ${pill(s.status, tone)}
      <div class="mut">SLO ${(s.slo * 100).toFixed(2)}% over 30 days. ${escapeHtml(s.def)}</div>
      <p>Total budget ${oneDecimal(s.budget)} min. Consumed ${oneDecimal(s.used)} min (${oneDecimal(s.pct * 100)}%). ${remaining}</p>
      <div class="rec ${tone}"><b>Recommendation</b>${escapeHtml(Logic.recommend(s.status))}</div>
      <div class="bar" role="img" aria-label="${oneDecimal(s.pct * 100)}% consumed"><i class="${tone}" style="width:${Math.min(100, s.pct * 100)}%"></i></div>
      <table><thead><tr><th>Incident</th><th>Date</th><th>Duration</th><th>Bad share</th><th>Consumed</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="5">No incidents consumed this budget.</td></tr>'}</tbody></table>
      <div class="mut">Consumed = duration (overlap removed) x share of bad requests.</div></section>`;
  }

  function reliabilitySummary(incidents) {
    const mttd = Logic.mttd(incidents);
    const withDetection = incidents.filter((i) => i.detectedMin != null).length;
    const resolved = incidents.filter((i) => i.status === 'Resolved').length;
    return `<h2>Reliability summary</h2><section><div class="grid">
      <div><div class="mut">MTTD</div><div class="big">${mttd == null ? 'n/a' : oneDecimal(mttd) + ' min'}</div><div class="mut">Mean of detection delay; ${withDetection} of ${incidents.length} incidents have a recorded detection time.</div></div>
      <div><div class="mut">MTTR</div><div class="big">${oneDecimal(Logic.mttr(incidents))} min</div><div class="mut">Mean incident duration (start to restore), resolved incidents only (${resolved} of ${incidents.length}). 90-day charts are not built yet; the seed has only ${incidents.length} incidents.</div></div></div></section>`;
  }

  function budgetsTab(incidents, summaries) {
    return `<h2>Error budgets (30-day window from ${SEED.window.start})</h2>
      <div class="mut" style="margin-bottom:10px">Status: Healthy under 50% consumed, At risk from 50% to under 100%, Exhausted at 100% or more.</div>
      <div class="grid two">${summaries.map(budgetCard).join('')}</div>${reliabilitySummary(incidents)}`;
  }

  // ---------- 7. Render ----------

  /** Rebuild the page from state, then put the scroll position back so nothing jumps. */
  function render() {
    const scrollY = window.scrollY;
    const incidents = getIncidents();
    const summaries = summarizeBudgets(incidents);

    let body;
    if (state.tab === 'dora') body = doraTab();
    else if (state.tab === 'budgets') body = budgetsTab(incidents, summaries);
    else body = incidentsTab(incidents, summaries);

    document.getElementById('app').innerHTML = tabBar() + body;
    renderLogs(incidents.find((i) => i.id === state.selectedId));
    window.scrollTo({ top: scrollY, behavior: 'instant' });
  }

  // ---------- 8. Event handlers ----------

  /** Copy a button's target text to the clipboard, falling back to a hidden textarea. */
  function copyText(button) {
    const el = document.getElementById(button.dataset.t);
    const text =
      el.tagName === 'UL'
        ? 'Impact\n' + [...el.children].map((li) => '• ' + li.innerText).join('\n')
        : el.innerText;
    const done = () => {
      button.textContent = 'Copied';
    };
    const fallback = () => {
      const box = document.createElement('textarea');
      box.value = text;
      document.body.appendChild(box);
      box.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        button.textContent = 'Select the text and copy';
      }
      box.remove();
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /** What each data-a action does. `value` is the button's data-v. */
  const actions = {
    /** Show an incident. From another tab, switch to Incidents and scroll to it. */
    open(button, id) {
      const previousTab = state.tab;
      state.selectedId = id;
      state.selectedLog = null;
      state.tab = 'incidents';
      render();
      if (previousTab !== 'incidents') scrollToElement(document.getElementById('detail'));
    },
    tab(button, tab) {
      state.tab = tab;
      render();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
    pmopen() {
      state.postmortemOpenFor =
        state.postmortemOpenFor === state.selectedId ? null : state.selectedId;
      render();
    },
    copy: copyText,
    viewpm(button, id) {
      const postmortem = SEED.postmortems.find((p) => p.id === id);
      state.viewer = { title: postmortem.title, text: postmortem.body };
      render();
      scrollToElement(document.getElementById('draft'));
    },
    close() {
      state.viewer = null;
      render();
    },
    log(button, index) {
      state.selectedLog = Number(index);
      renderLogs(getIncidents().find((i) => i.id === state.selectedId));
    },
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-a]');
    if (!button) return;
    const handler = actions[button.dataset.a];
    if (handler) handler(button, button.dataset.v);
  });

  // The log filters only redraw the log table, so typing keeps focus in the search box.
  document.addEventListener('input', (event) => {
    if (event.target.id !== 'q' && event.target.id !== 'lvl') return;
    if (event.target.id === 'q') state.logQuery = event.target.value;
    else state.logLevel = event.target.value;
    renderLogs(getIncidents().find((i) => i.id === state.selectedId));
  });

  document.addEventListener('change', (event) => {
    if (!event.target.dataset.ck) return;
    state.checked[event.target.dataset.ck] = event.target.checked;
    saveChecklist();
  });

  render();
})();
