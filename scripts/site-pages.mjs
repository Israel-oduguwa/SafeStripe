export const sitePages = [
  {
    slug: '',
    source: 'index.html',
    title: 'SafeStripe — Durable Stripe workflows for Node.js',
    description:
      'Keep operation identity, webhook work and business effects recoverable across retries and process failure.',
  },
  {
    slug: 'demo',
    source: 'pages/demo.html',
    title: 'A failed payment. A clean recovery. — SafeStripe',
    description:
      'Watch a 30-second motion replay of a real Stripe sandbox decline, same-session retry and a separate duplicate-delivery test.',
  },
  {
    slug: 'reliability',
    source: 'pages/reliability.html',
    title: 'Reliability contracts — SafeStripe',
    description:
      'Five database-backed reliability contracts, their failure scenarios, test evidence and boundaries.',
  },
  {
    slug: 'benchmarks',
    source: 'pages/benchmarks.html',
    title: 'Recorded benchmarks — SafeStripe',
    description:
      'Inspect retained SQLite and PostgreSQL workload measurements, latency, retry counts, machine details and failed attempts.',
  },
  {
    slug: 'examples',
    source: 'pages/examples.html',
    title: 'Express and Next.js examples — SafeStripe',
    description:
      'Server-side checkout examples, storage requirements and guides for Express, Next.js and Cloud Firestore.',
  },
  {
    slug: 'get-started',
    source: 'pages/get-started.html',
    title: 'Make your first payment — SafeStripe',
    description:
      'Try a hosted Stripe sandbox payment or install SafeStripe in your application and follow the saved receipt.',
  },
  {
    slug: 'releases',
    source: 'pages/releases.html',
    title: 'Release status and evidence — SafeStripe',
    description:
      'SafeStripe 0.3.0 release status, verified sandbox payment journeys, public CI and remaining adoption requirements.',
  },
];

export const benchmarkFiles = [
  { id: 'postgres-1', label: 'PostgreSQL · 1 lane', file: 'postgres-1-workers.json' },
  { id: 'postgres-4', label: 'PostgreSQL · 4 lanes', file: 'postgres-4-workers.json' },
  { id: 'postgres-8', label: 'PostgreSQL · 8 lanes', file: 'postgres-8-workers.json' },
  { id: 'sqlite', label: 'SQLite · local baseline', file: 'sqlite-latest.json' },
];

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

export function number(value, digits = 0) {
  if (value === undefined || value === null) return 'Not recorded';
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid benchmark measurement');
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function table(caption, headers, rows, attributes = '') {
  return `<div class="table-scroll" role="region" aria-label="${escapeHtml(caption)}" tabindex="0"><table ${attributes}><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell, index) => `<${index ? 'td' : 'th scope="row"'}>${cell}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function validateRun(run) {
  if (!Number.isInteger(run.events) || run.events < 1)
    throw new Error('Missing benchmark event count');
  for (const count of ['effects', 'outbox', 'done']) {
    if (run.counts[count] !== run.events)
      throw new Error('Benchmark business invariant failed: ' + count);
  }
  if (run.duplicateEffects !== 0) throw new Error('Benchmark contains duplicate effects');
}

function reportPanel({ id, label, file, data }) {
  if (!Array.isArray(data.results) || !data.results.length || data.passed === false)
    throw new Error('No measured results: ' + file);
  data.results.forEach(validateRun);
  if (data.warmup) validateRun(data.warmup);
  const first = data.results[0];
  const env = data.environment;
  const connections =
    typeof env.connections === 'number'
      ? `${env.connections} SQLite connection`
      : `${env.connections.workloadPoolMax} workload + ${env.connections.schemaAdminPoolMax} schema-admin connections`;
  const details = [
    ['Recorded', new Date(data.recordedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ['Runtime', `${env.node} · ${env.platform}/${env.arch}`],
    ['Database', first.version],
    ['CPU', `${env.cpu} · ${env.logicalCpus} logical CPUs`],
    ['Host RAM', `${number(env.memoryBytes / 1024 ** 3, 2)} GiB`],
    ['Connections', connections],
    ['Worker lanes', `${first.workers} in one process`],
    ['Location', env.location],
  ];
  const throughput = table(
    'Measured throughput and failed attempts',
    [
      'Run',
      'Admission attempts/s',
      'Committed effects/s',
      'Callback retries',
      'Failed worker attempts',
      'Exhausted retryable transactions',
      'Duplicate effects',
    ],
    data.results.map((run, i) => [
      number(i + 1),
      number(run.admissionAttemptsPerSecond),
      number(run.committedEffectsPerSecond),
      number(run.transactionCallbackRetries),
      number(run.workerErrors),
      number(run.retryableTransactionFailures),
      number(run.duplicateEffects),
    ]),
    'data-measurements="throughput"',
  );
  const latency = table(
    'Latency per measured repetition · milliseconds',
    ['Run', 'Measurement', 'p50 ms', 'p95 ms', 'p99 ms'],
    data.results.flatMap((run, i) =>
      [
        ['Admission', run.admission],
        ['Worker iteration', run.workerIteration],
        ['Admission to commit', run.admissionToCommit],
      ].map(([name, values]) => [
        number(i + 1),
        name,
        number(values.p50Ms, 2),
        number(values.p95Ms, 2),
        number(values.p99Ms, 2),
      ]),
    ),
    'data-measurements="latency"',
  );
  const resources = table(
    'Process resources and committed state',
    [
      'Run',
      'Process CPU ms',
      'Peak RSS MiB',
      'Completed jobs',
      'Effects',
      'Outbox intents',
      'Claimants / owners / busy',
    ],
    data.results.map((run, i) => [
      number(i + 1),
      number((run.cpuMicroseconds.user + run.cpuMicroseconds.system) / 1000),
      number(run.peakRssBytes / 1024 ** 2, 2),
      number(run.counts.done),
      number(run.counts.effects),
      number(run.counts.outbox),
      `${number(run.contention.claimants)} / ${number(run.contention.owners)} / ${number(run.contention.busy)}`,
    ]),
    'data-measurements="resources"',
  );
  const warmup = data.warmup
    ? `<p><strong>Warm-up retained, excluded from rates:</strong> ${number(data.warmup.events)} unique events; ${number(data.warmup.workerErrors)} failed worker attempts; ${number(data.warmup.retryableTransactionFailures)} exhausted retryable transactions; ${number(data.warmup.transactionCallbackRetries)} callback retries. Final state: ${number(data.warmup.counts.done)} jobs, ${number(data.warmup.counts.effects)} effects and ${number(data.warmup.counts.outbox)} outbox intents; ${number(data.warmup.duplicateEffects)} duplicate effects.</p>`
    : '<p><strong>Legacy baseline:</strong> no warm-up observation or exhausted-transaction count was recorded. Four same-process worker lanes shared one SQLite connection; this does not establish support for multiple production workers. Other development work was running on the laptop.</p>';
  return `<section id="${id}-panel" role="tabpanel" aria-labelledby="${id}-tab" data-source="${file}" class="benchmark-panel"><div class="benchmark-heading"><div><h3>${escapeHtml(label)}</h3><p>${data.passed === true ? 'Protocol passed' : 'Legacy baseline'} · ${data.results.length} measured repetitions</p></div><a class="text-link" href="./results/${file}">Raw result JSON ↗</a></div><div class="metric-grid"><div><strong>${number(first.events)}</strong><span>Unique events / run</span></div><div><strong>${number(first.deliveryAttempts)}</strong><span>Admission attempts / run</span></div><div><strong>${data.results.length}</strong><span>Measured repetitions</span></div><div><strong>${number(data.results.reduce((sum, run) => sum + run.duplicateEffects, 0))}</strong><span>Duplicate effects in measured runs</span></div></div>${throughput}<details class="benchmark-details"><summary>Latency, resources and committed state</summary>${latency}${resources}</details><div class="warmup-note">${warmup}</div><details class="benchmark-details"><summary>Machine, source revision and protocol</summary><dl class="environment-grid">${details.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><p>${escapeHtml(data.methodology)}</p><p class="source-note">${data.sourceDirty ? 'Parent revision; modified source inputs were fingerprinted' : 'Tested source revision'}: <code>${escapeHtml(data.sourceCommit)}</code><br />Source SHA-256: <code>${escapeHtml(data.sourceSha256)}</code></p></details></section>`;
}

export function renderBenchmarks(reports) {
  return `<div class="tab-list benchmark-tabs" role="tablist" aria-label="Recorded benchmark configuration">${reports.map(({ id, label }, i) => `<button id="${id}-tab" role="tab" aria-selected="${i === 0}" aria-controls="${id}-panel" tabindex="${i === 0 ? 0 : -1}">${escapeHtml(label)}</button>`).join('')}</div>${reports.map(reportPanel).join('')}`;
}

export function renderAttempts(reports) {
  return table(
    'Original PostgreSQL matrix · retained outcomes',
    [
      'Lanes',
      'Protocol outcome',
      'Measured runs',
      'Warm-up failed worker attempts',
      'Warm-up final jobs / effects / outbox',
      'Report',
    ],
    reports.map(({ file, data }) => {
      const observation = data.failure?.observation;
      return [
        number(data.configuration.workers),
        data.passed ? 'Passed' : 'Failed during warm-up',
        number(data.results.length),
        number(observation?.drain.handlerFailures),
        observation
          ? `${number(observation.counts.done)} / ${number(observation.counts.effects)} / ${number(observation.counts.outbox)}`
          : 'Not recorded',
        `<a href="./results/${file}">Original JSON ↗</a>`,
      ];
    }),
    'data-measurements="original-attempts"',
  );
}
