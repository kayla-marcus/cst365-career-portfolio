/**
 * Meridian SRE dashboard - calculations.
 *
 * Pure functions with no DOM access, so they can be unit tested in Node
 * (tests/logic.test.js) and reused in the browser (exposed as the global `Logic`).
 *
 * Sections: constants, incident status, error budgets, detection and restore times,
 *           related postmortems, DORA metrics, postmortem starter text.
 */
(function (root) {
  const Logic = {};

  const UNKNOWN = 'Unknown - requires human review';
  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
  const oneDecimal = (n) => n.toFixed(1);
  const mean = (numbers) =>
    numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : null;
  const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    if (!sorted.length) return null;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  // ---------- Incident status ----------

  /** Status is detected from data: an incident is Resolved once a restore time is recorded. */
  Logic.status = (incident) =>
    incident.restoredAt && new Date(incident.restoredAt) >= new Date(incident.start)
      ? 'Resolved'
      : 'Active';
  Logic.isActive = (incident) => Logic.status(incident) === 'Active';

  // ---------- Error budgets ----------

  /** Minutes of unreliability an SLO allows in a window. 99.9% over 30 days = 43.2. */
  Logic.budgetMinutes = (slo, windowDays) => (1 - slo) * windowDays * 24 * 60;

  /**
   * Adds `effMin` to each incident: its minutes after removing any overlap with earlier
   * incidents, so the same minute is never charged to a budget twice.
   * Pass incidents that share one SLI.
   */
  Logic.effective = (incidents) => {
    let latestEnd = -Infinity;
    return [...incidents]
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .map((incident) => {
        const start = new Date(incident.start).getTime();
        const end = start + incident.durationMin * MS_PER_MINUTE;
        const effMin = Math.max(0, (end - Math.max(start, latestEnd)) / MS_PER_MINUTE);
        latestEnd = Math.max(latestEnd, end);
        return { ...incident, effMin };
      });
  };

  /**
   * Error budget for each SLO. An incident only spends the budget of the SLI it is linked to.
   *   consumed = effective minutes x share of requests that were bad
   * Returns each SLO plus: budget, used, remaining (negative when over), pct (1 = 100%),
   * status (Healthy < 50%, At risk < 100%, Exhausted), and the incident rows behind `used`.
   */
  Logic.summarize = (seed) => {
    const windowStart = new Date(seed.window.start).getTime();
    const windowEnd = windowStart + seed.window.days * MS_PER_DAY;
    return seed.slis.map((sli) => {
      const inWindow = seed.incidents.filter((incident) => {
        const start = new Date(incident.start).getTime();
        return incident.sli === sli.id && start >= windowStart && start < windowEnd;
      });
      const rows = Logic.effective(inWindow).map((incident) => ({
        id: incident.id,
        title: incident.title,
        start: incident.start,
        durationMin: incident.durationMin,
        effMin: incident.effMin,
        badShare: incident.badShare,
        consumed: incident.effMin * incident.badShare,
      }));
      const budget = Logic.budgetMinutes(sli.slo, seed.window.days);
      const used = rows.reduce((sum, row) => sum + row.consumed, 0);
      const pct = used / budget;
      const status = pct >= 1 ? 'Exhausted' : pct >= 0.5 ? 'At risk' : 'Healthy';
      return { ...sli, budget, used, remaining: budget - used, pct, status, rows };
    });
  };

  Logic.RECS = {
    Healthy:
      'Business as usual. Ship on the normal schedule and keep watching how fast the budget is used.',
    'At risk':
      'Avoid risky deployments in this area. Require a tested rollback plan and extra review for changes to this service until the budget recovers.',
    Exhausted:
      'Stop deploying new features that affect this budget. Focus on fixes and reliability work until the budget resets or recovers.',
  };
  Logic.recommend = (budgetStatus) => Logic.RECS[budgetStatus];

  // ---------- Detection and restore times ----------

  /** Mean minutes to detect, over incidents with a recorded detection time. Null if none. */
  Logic.mttd = (incidents) =>
    mean(incidents.filter((i) => i.detectedMin != null).map((i) => i.detectedMin));
  /** Mean incident duration, over Resolved incidents only (ongoing ones have no final length). */
  Logic.mttr = (incidents) =>
    mean(incidents.filter((i) => Logic.status(i) === 'Resolved').map((i) => i.durationMin));

  // ---------- Related postmortems ----------

  /** For each shared tag: what is observed, and what it might suggest (unconfirmed). */
  const TAG_TEXT = {
    'recent-change': [
      'both incidents began after a deployment or configuration change',
      'checking recent changes first may help',
    ],
    'connection-pool': [
      'both show connection-pool evidence',
      'pool saturation is a candidate cause',
    ],
    'no-user-facing-alert': [
      'neither was caught by a user-facing alert',
      'symptom-based alerting could shorten detection',
    ],
  };

  /**
   * Postmortems for OTHER incidents that share at least one tag with this incident.
   * Rule-based and deterministic: no AI model is called. Observed facts are kept
   * separate from inferences, and the caveat says matching is by tags only.
   */
  Logic.related = (incident, postmortems) =>
    postmortems
      .filter((pm) => pm.incident !== incident.id)
      .map((pm) => {
        const shared = pm.tags.filter((tag) => incident.tags.includes(tag));
        const text = shared.map((tag) => TAG_TEXT[tag] || [tag, '']);
        return {
          pm,
          shared,
          observed: text.map(([observed]) => observed),
          inferred: text.map(([, inferred]) => inferred).filter(Boolean),
          caveat: 'Matched on shared tags only. No common root cause is established.',
        };
      })
      .filter((match) => match.shared.length);

  // ---------- DORA metrics ----------

  /**
   * Parse CSV text into objects. Handles plain comma-separated values only (no quoted
   * fields). Empty cells become null, True/False become booleans, other columns numbers.
   */
  Logic.parseCsv = (text) => {
    const TEXT_COLUMNS = [
      'id',
      'data_source',
      'commit_time',
      'deploy_time',
      'failure_cause',
      'incident_id',
    ];
    const [header, ...rows] = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(','));
    const parseCell = (column, cell) => {
      if (cell === '' || cell == null) return null;
      if (TEXT_COLUMNS.includes(column)) return cell;
      if (cell === 'True' || cell === 'False') return cell === 'True';
      return Number(cell);
    };
    return rows.map((row) =>
      Object.fromEntries(header.map((column, i) => [column, parseCell(column, row[i])]))
    );
  };

  /** The `count` most recent deployments, newest first. */
  Logic.recent = (deployments, count) =>
    [...deployments].sort((a, b) => b.deploy_time.localeCompare(a.deploy_time)).slice(0, count);

  /**
   * Group deployments into weeks that start on Monday (UTC). Weeks with no deployments
   * between the first and last are kept so charts show the gap.
   * Each week: { week: 'YYYY-MM-DD', count, medianLeadMin, failed, cfr }.
   */
  Logic.weekly = (deployments) => {
    const mondayOf = (isoTime) => {
      const t = new Date(isoTime + 'Z');
      const daysSinceMonday = (t.getUTCDay() + 6) % 7;
      return (
        Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - daysSinceMonday * MS_PER_DAY
      );
    };
    const byWeek = {};
    deployments.forEach((d) => {
      const monday = mondayOf(d.deploy_time);
      (byWeek[monday] = byWeek[monday] || []).push(d);
    });
    const mondays = Object.keys(byWeek).map(Number);
    const weeks = [];
    for (let t = Math.min(...mondays); t <= Math.max(...mondays); t += 7 * MS_PER_DAY) {
      const inWeek = byWeek[t] || [];
      const failed = inWeek.filter((d) => d.failed).length;
      weeks.push({
        week: new Date(t).toISOString().slice(0, 10),
        count: inWeek.length,
        medianLeadMin: median(inWeek.map((d) => d.lead_time_minutes)),
        failed,
        cfr: inWeek.length ? failed / inWeek.length : null,
      });
    }
    return weeks;
  };

  /** The four DORA metrics for a list of deployments. Times are in minutes. */
  Logic.dora = (deployments) => {
    const failures = deployments.filter((d) => d.failed);
    const recoveries = failures.map((d) => d.recovery_minutes).filter((m) => m != null);
    return {
      total: deployments.length,
      failed: failures.length,
      dfPerWeek: deployments.length / Logic.weekly(deployments).length,
      medianLeadMin: median(deployments.map((d) => d.lead_time_minutes)),
      cfr: failures.length / deployments.length,
      mttrMin: mean(recoveries),
    };
  };

  /**
   * Rating bands. `cut` lists the Elite, High, and Medium boundaries in order; anything
   * past the last boundary is Low. The Elite and Low edges follow the course lesson;
   * the middle bands are this project's assumption, based on DORA research.
   */
  Logic.BANDS = {
    df: {
      higherIsBetter: true,
      cut: [1, 1 / 7, 1 / 30],
      text: 'Elite: daily or more. High: weekly. Medium: monthly. Low: less often.',
    }, // per day
    lead: {
      cut: [60, 1440, 10080],
      text: 'Elite: under 1 hour. High: under 1 day. Medium: under 1 week. Low: longer.',
    }, // minutes
    cfr: {
      cut: [0.05, 0.1, 0.15],
      text: 'Elite: under 5%. High: under 10%. Medium: under 15%. Low: 15% or more.',
    }, // fraction
    mttr: {
      cut: [60, 1440, 10080],
      text: 'Elite: under 1 hour. High: under 1 day. Medium: under 1 week. Low: longer.',
    }, // minutes
  };

  /** 'Elite' | 'High' | 'Medium' | 'Low' for a metric key (df, lead, cfr, mttr) and value. */
  Logic.rate = (metric, value) => {
    const { cut, higherIsBetter } = Logic.BANDS[metric];
    const band = cut.findIndex((limit) => (higherIsBetter ? value >= limit : value < limit));
    return band < 0 ? 'Low' : ['Elite', 'High', 'Medium'][band];
  };

  // ---------- Postmortem starter ----------

  /**
   * Opening summary and impact for a Resolved incident, built only from recorded data.
   * Anything not recorded says "Unknown - requires human review" instead of being invented.
   * `summaries` is the result of Logic.summarize.
   */
  Logic.draftStart = (incident, summaries) => {
    const sli = summaries.find((s) => s.id === incident.sli);
    const row = sli.rows.find((r) => r.id === incident.id);
    const clock = (isoTime) => new Date(isoTime).toISOString().slice(11, 16); // HH:MM

    const summary =
      `On ${incident.start.slice(0, 10)} from ${clock(incident.start)} to ${clock(incident.restoredAt)} UTC ` +
      `(${incident.durationMin} minutes), about ${Math.round(incident.badShare * 100)}% of ` +
      `${incident.requestNoun} requests ${incident.badVerb}. ` +
      (incident.cause || `Cause: ${UNKNOWN}.`);

    const budgetText =
      `${oneDecimal(row.consumed)} of ${oneDecimal(sli.budget)} minutes used ` +
      `(${oneDecimal((row.consumed / sli.budget) * 100)}%), ` +
      (sli.remaining >= 0
        ? `leaving ${oneDecimal(sli.remaining)} minutes for the rest of the 30-day window.`
        : `which is ${oneDecimal(-sli.remaining)} minutes over the 30-day budget.`);
    const detectText =
      incident.detectedMin != null
        ? `${incident.detectedMin} minutes to detect`
        : 'Detection time unknown';

    return {
      summary,
      impact: [
        { label: 'Customers', text: incident.customerImpact || UNKNOWN },
        { label: 'Error budget', text: budgetText },
        { label: 'Durations', text: `${detectText}, ${incident.durationMin} minutes to restore.` },
      ],
    };
  };

  if (typeof module !== 'undefined') module.exports = Logic;
  else root.Logic = Logic;
})(this);
