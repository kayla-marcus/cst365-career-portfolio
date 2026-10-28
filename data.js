/**
 * Meridian SRE dashboard - seed data (synthetic).
 *
 * Everything the interface shows comes from here, so numbers cannot disagree between views.
 * INC-1's numbers come from my Meridian assignment; INC-2 to INC-4 details are invented
 * and labeled "(synthetic)" in their text. Nothing here is real or live.
 *
 * Shape of an incident (all fields are read by src/app.js or src/logic.js):
 *   sli            id of the SLO whose budget it spends (one incident spends one SLI)
 *   durationMin    minutes from impact start to restore (so far, if still active)
 *   badShare       fraction of that SLI's requests that were bad during the incident
 *   detectedMin    minutes from impact start to detection, or null if not recorded
 *   restoredAt     ISO time the system was restored; null means the incident is Active
 *   requestNoun, badVerb, cause, customerImpact   wording for the postmortem starter
 *   tags           used to match related postmortems
 *   runbook        key into `runbooks`, or null when none exists
 *   contact        (active incidents) escalation roles to highlight, each with a reason
 */
const SEED = {
  // The 30-day error budget window.
  window: { start: '2026-09-01', days: 30 },
  // SLOs. Each one has its own error budget.
  slis: [
    {
      id: 'SLI-1',
      service: 'Payment API',
      name: 'Availability',
      slo: 0.999,
      def: 'Successful payment requests / all payment requests',
    },
    {
      id: 'SLI-2',
      service: 'Mobile authentication',
      name: 'Latency (under 2 s)',
      slo: 0.99,
      def: 'Logins completing in under 2 s / all logins',
    },
    {
      id: 'SLI-3',
      service: 'Funds transfers',
      name: 'Posting latency (under 60 s)',
      slo: 0.995,
      def: 'Transfers posted within 60 s / all transfers',
    },
    {
      id: 'SLI-4',
      service: 'Account balance API',
      name: 'Availability',
      slo: 0.999,
      def: 'Successful balance requests / all balance requests',
    },
  ],
  // Incidents. See the field guide at the top of this file.
  incidents: [
    {
      id: 'INC-1',
      title: 'Payment processing outage',
      service: 'Payment API',
      runbook: 'payment',
      sli: 'SLI-1',
      sev: 'SEV-1',
      start: '2026-09-08T02:14:00Z',
      durationMin: 47,
      badShare: 0.6,
      detectedMin: 13,
      restoredAt: '2026-09-08T03:01:00Z',
      requestNoun: 'payment',
      badVerb: 'failed',
      cause:
        'A release deployed at 01:52 UTC held a database connection while waiting on an external fraud-scoring call, and as evening traffic rose the payment service ran out of connections.',
      customerImpact:
        'about 31,000 failed payment attempts (estimate), plus 23 payments left in an ambiguous state that were resolved by 2026-09-09.',
      detection:
        'Customer support escalated by phone at 02:27 UTC (13 min after impact began). No alert fired.',
      tags: ['recent-change', 'connection-pool', 'no-user-facing-alert', 'slow-diagnosis'],
      metrics: [
        { name: 'Payment error rate (estimate)', value: 60, unit: '%', limit: 2 },
        { name: 'DB connection pool use', value: 100, unit: '%', limit: 80 },
        { name: 'Request volume (estimate)', value: 1100, unit: 'req/min', limit: null },
      ],
      alert: {
        name: 'PaymentErrorRateHigh',
        rule: 'Error rate above 2% for 2 min',
        state: 'Proposed (none existed during the incident)',
      },
      logs: [
        {
          ts: '02:05:12',
          level: 'WARN',
          service: 'payment-service',
          trace: 'a1f3c9',
          req: 'r-47001',
          msg: 'connection pool use at 71%',
        },
        {
          ts: '02:14:08',
          level: 'ERROR',
          service: 'payment-service',
          trace: 'b72d10',
          req: 'r-48213',
          msg: 'timed out waiting for connection from pool (100/100)',
        },
        {
          ts: '02:31:40',
          level: 'ERROR',
          service: 'api-gateway',
          trace: 'c90e44',
          req: 'r-49977',
          msg: 'upstream payment-service returned 504',
        },
        {
          ts: '02:52:03',
          level: 'INFO',
          service: 'deploy-pipeline',
          trace: '-',
          req: '-',
          msg: 'rollback to v4.11 started',
        },
        {
          ts: '02:58:30',
          level: 'INFO',
          service: 'payment-service',
          trace: 'd11a02',
          req: 'r-50410',
          msg: 'connection pool use at 22%',
        },
      ],
      timeline: [
        ['01:52', 'Release v4.12 deployed to all pods'],
        ['02:14', 'Pool reaches 100%; payments time out (impact begins)'],
        ['02:27', 'Support escalates to on-call (detection)'],
        ['02:47', 'Onset linked to v4.12; decision to roll back'],
        ['02:58', 'Rollback to v4.11 completes'],
        ['03:01', 'Failure rate below 0.1% (restored)'],
      ],
    },
    {
      id: 'INC-2',
      title: 'Mobile authentication degradation',
      service: 'Mobile authentication',
      runbook: null,
      sli: 'SLI-2',
      sev: 'SEV-2',
      start: '2026-09-22T14:30:00Z',
      durationMin: 150,
      badShare: 0.4,
      detectedMin: null,
      restoredAt: null,
      requestNoun: 'login',
      badVerb: 'were slower than 2 seconds',
      detection: null,
      tags: ['recent-change', 'auth-latency'],
      metrics: [{ name: 'Slow logins (over 2 s, estimate)', value: 40, unit: '%', limit: 1 }],
      alert: null,
      logs: [
        {
          ts: '14:05:00',
          level: 'INFO',
          service: 'auth-service',
          trace: '-',
          req: '-',
          msg: 'token cache configuration changed (synthetic)',
        },
        {
          ts: '14:31:12',
          level: 'WARN',
          service: 'auth-service',
          trace: 'e5c7a1',
          req: 'r-91002',
          msg: 'token validation slow; cache miss ratio elevated (synthetic)',
        },
        {
          ts: '14:44:50',
          level: 'ERROR',
          service: 'mobile-gateway',
          trace: 'f8b3d6',
          req: 'r-91877',
          msg: 'login request exceeded 2 s budget (synthetic)',
        },
      ],
      timeline: [['14:30', 'Degradation begins (about 40% of logins slower than 2 s)']],
    },
    {
      id: 'INC-3',
      title: 'Funds transfer posting backlog',
      service: 'Funds transfers',
      runbook: 'transfers',
      sli: 'SLI-3',
      sev: 'SEV-2',
      start: '2026-09-29T09:40:00Z',
      durationMin: 38,
      badShare: 0.35,
      detectedMin: 9,
      restoredAt: null,
      requestNoun: 'transfer',
      badVerb: 'posted late',
      cause: null,
      detection:
        'Alert TransferQueueBacklogHigh fired and paged on-call at 09:49 UTC, 9 min after posting delays began (synthetic).',
      tags: ['queue-backlog', 'downstream-timeout'],
      metrics: [
        { name: 'Transfer queue depth', value: 8400, unit: ' msgs', limit: 5000 },
        { name: 'Posting delay p95', value: 185, unit: ' s', limit: 60 },
        { name: 'Transfers posted late (estimate)', value: 35, unit: '%', limit: 0.5 },
      ],
      alert: {
        name: 'TransferQueueBacklogHigh',
        rule: 'Queue depth above 5,000 messages for 5 min',
        state: 'Firing since 09:49 UTC',
      },
      contact: [
        { role: 'Primary on-call SRE', why: 'You are paged. Acknowledge and lead the response.' },
        {
          role: 'Secondary on-call (database)',
          why: 'Logs show ledger database calls timing out.',
        },
        { role: 'Transfers platform on-call', why: 'Workers are retrying and requeuing messages.' },
      ],
      logs: [
        {
          ts: '09:40:11',
          level: 'WARN',
          service: 'queue-broker',
          trace: '-',
          req: '-',
          msg: 'consumer group transfer-posting lag at 1,200 and rising (synthetic)',
        },
        {
          ts: '09:41:37',
          level: 'ERROR',
          service: 'transfer-worker',
          trace: 'g2a8c1',
          req: 'r-77120',
          msg: 'ledger-db call timed out after 30 s; retrying (synthetic)',
        },
        {
          ts: '09:44:10',
          level: 'WARN',
          service: 'queue-broker',
          trace: '-',
          req: '-',
          msg: 'queue depth passed 5,000 (5,012) (synthetic)',
        },
        {
          ts: '09:47:22',
          level: 'ERROR',
          service: 'transfer-worker',
          trace: 'h7d3b9',
          req: 'r-77341',
          msg: 'retry budget exhausted for 212 messages; requeued (synthetic)',
        },
        {
          ts: '09:49:00',
          level: 'INFO',
          service: 'alertmanager',
          trace: '-',
          req: '-',
          msg: 'TransferQueueBacklogHigh firing; on-call paged (synthetic)',
        },
      ],
      timeline: [
        ['09:40', 'Posting delays begin'],
        ['09:44', 'Queue depth passes 5,000'],
        ['09:49', 'Alert TransferQueueBacklogHigh fires and pages on-call'],
      ],
    },
    {
      id: 'INC-4',
      title: 'Account balance outage',
      service: 'Account balance API',
      runbook: null,
      sli: 'SLI-4',
      sev: 'SEV-1',
      start: '2026-09-15T16:20:00Z',
      durationMin: 52,
      badShare: 1.0,
      detectedMin: 6,
      restoredAt: '2026-09-15T17:12:00Z',
      requestNoun: 'balance',
      badVerb: 'failed',
      cause:
        'The upstream core-banking service stopped responding and the balance API had no fallback (synthetic).',
      customerImpact: null,
      detection:
        'Alert BalanceApiErrorRateHigh paged on-call at 16:26 UTC, 6 min after impact began (synthetic).',
      tags: ['dependency-failure'],
      metrics: [
        { name: 'Balance request error rate (estimate)', value: 100, unit: '%', limit: 2 },
        { name: 'Upstream call timeouts (estimate)', value: 100, unit: '%', limit: 1 },
      ],
      alert: {
        name: 'BalanceApiErrorRateHigh',
        rule: 'Error rate above 2% for 2 min',
        state: 'Resolved at 17:12 UTC',
      },
      logs: [
        {
          ts: '16:20:05',
          level: 'ERROR',
          service: 'balance-api',
          trace: 'k3m9a2',
          req: 'r-62001',
          msg: 'core-banking call timed out after 10 s (synthetic)',
        },
        {
          ts: '16:24:40',
          level: 'ERROR',
          service: 'balance-api',
          trace: 'k4n1b8',
          req: 'r-62190',
          msg: 'all balance requests failing; no cached fallback (synthetic)',
        },
        {
          ts: '16:26:00',
          level: 'INFO',
          service: 'alertmanager',
          trace: '-',
          req: '-',
          msg: 'BalanceApiErrorRateHigh firing; on-call paged (synthetic)',
        },
        {
          ts: '17:12:10',
          level: 'INFO',
          service: 'balance-api',
          trace: 'k9z2c4',
          req: 'r-63877',
          msg: 'core-banking calls succeeding; error rate below 0.1% (synthetic)',
        },
      ],
      timeline: [
        ['16:20', 'Balance requests begin failing'],
        ['16:26', 'Alert fires and pages on-call'],
        ['17:12', 'Upstream recovers; service restored'],
      ],
    },
  ],
  // Written postmortems. `tags` match them to other incidents.
  postmortems: [
    {
      id: 'PM-1',
      incident: 'INC-1',
      title: 'Postmortem: Payment Processing Outage',
      date: '2026-09-10',
      service: 'Payment API',
      tags: ['recent-change', 'connection-pool', 'no-user-facing-alert', 'slow-diagnosis'],
      body: 'Summary: A release held DB connections during an external call; the pool filled as evening traffic rose. About 60% of payments failed for 47 minutes. Detected after 13 minutes by support; restored by rollback.\n\nBudget: 28.2 of 43.2 minutes (65.3%).\n\nActions: alert on error rate and pool use; feature flags; updated runbook; structured logs and traces; production-peak load test and canary.',
    },
  ],
  // Runbooks, keyed by the `runbook` field of an incident.
  runbooks: {
    payment: {
      title: 'On-Call Runbook: Payment Processing Service',
      service: 'Payment API',
      thresholds: [
        ['Payment error rate', 'Above 2% for 2 min', 'SEV-1 page'],
        ['Synthetic test payment', '2 consecutive failures', 'SEV-1 page'],
        ['DB pool use', 'Above 80% for 2 min', 'SEV-2 page'],
        ['p95 latency', 'Above 800 ms for 5 min', 'SEV-2 page'],
      ],
      steps: [
        'Acknowledge within 5 minutes; open the incident channel; declare incident commander for SEV-1',
        'Confirm impact on the gateway dashboard and send a test payment',
        'Check deployments and flag changes in the last 24 hours; if a release preceded impact, go to step 5',
        'Check the database: pool use, idle-in-transaction connections, replication lag',
        'Mitigate: disable the feature flag or roll back; confirm no schema change with release engineering',
        'Verify: error rate below 0.1%, pool use below 60%, test payment succeeds; watch 15 minutes',
        'Communicate every 15 minutes; check ambiguous payments; schedule a postmortem within 2 business days',
      ],
      escalation: [
        {
          level: 'L1',
          role: 'Primary on-call SRE',
          when: 'Paged by an alert',
          name: 'Avery Chen',
          email: 'avery.chen@meridianbank.example',
        },
        {
          level: 'L2',
          role: 'Secondary on-call (database)',
          when: 'No progress after 15 min, or pool and database symptoms',
          name: 'Jordan Patel',
          email: 'jordan.patel@meridianbank.example',
        },
        {
          level: 'L3',
          role: 'Payment platform on-call',
          when: 'A release or code change is suspected',
          name: 'Riley Okafor',
          email: 'riley.okafor@meridianbank.example',
        },
        {
          level: 'L4',
          role: 'Engineering manager',
          when: 'SEV-1 lasts over 30 min',
          name: 'Sam Rivera',
          email: 'sam.rivera@meridianbank.example',
        },
        {
          level: 'Notify',
          role: 'Customer support lead',
          when: 'Any SEV-1 with customer impact, within 15 min',
          name: 'Taylor Brooks',
          email: 'taylor.brooks@meridianbank.example',
        },
        {
          level: 'Notify',
          role: 'Compliance',
          when: 'Any SEV-1 with customer impact, within 15 min',
          name: 'Morgan Ellis',
          email: 'morgan.ellis@meridianbank.example',
        },
      ],
    },
    transfers: {
      title: 'On-Call Runbook: Funds Transfer Posting',
      service: 'Funds transfers',
      thresholds: [
        ['Queue depth', 'Above 5,000 messages for 5 min', 'SEV-2 page'],
        ['Posting delay p95', 'Above 60 s for 5 min', 'SEV-2 page'],
        ['Ledger DB call timeouts', 'Above 5% for 2 min', 'SEV-2 page'],
        ['Consumer lag', 'Rising for 10 min', 'Warning'],
      ],
      steps: [
        'Acknowledge within 5 minutes and open the incident channel',
        'Confirm the backlog: queue depth, consumer lag, and age of the oldest message',
        'Check the consumers: are transfer-worker pods running, consuming, and not restarting?',
        'Check the ledger database: latency, locks, and connections; page the database on-call if it is degraded',
        'Check what changed in the last 24 hours: deployments, configuration, and feature flags',
        'Mitigate: add transfer-worker replicas and pause non-urgent jobs that publish to the queue. Never purge the queue; each message is a customer transfer',
        'Verify: depth falling below 1,000, p95 under 60 s, no stuck messages; watch 15 minutes, then reconcile transfers posted twice or not at all',
      ],
      escalation: [
        {
          level: 'L1',
          role: 'Primary on-call SRE',
          when: 'Paged by an alert',
          name: 'Avery Chen',
          email: 'avery.chen@meridianbank.example',
        },
        {
          level: 'L2',
          role: 'Secondary on-call (database)',
          when: 'Ledger database slow or timing out',
          name: 'Jordan Patel',
          email: 'jordan.patel@meridianbank.example',
        },
        {
          level: 'L3',
          role: 'Transfers platform on-call',
          when: 'Workers or queue misbehaving, or a release is suspected',
          name: 'Casey Nguyen',
          email: 'casey.nguyen@meridianbank.example',
        },
        {
          level: 'L4',
          role: 'Engineering manager',
          when: 'SEV-2 lasts over 60 min or becomes SEV-1',
          name: 'Sam Rivera',
          email: 'sam.rivera@meridianbank.example',
        },
        {
          level: 'Notify',
          role: 'Customer support lead',
          when: 'Customers report delayed transfers',
          name: 'Taylor Brooks',
          email: 'taylor.brooks@meridianbank.example',
        },
      ],
    },
  },
};
if (typeof module !== 'undefined') module.exports = SEED;
