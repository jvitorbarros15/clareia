// Counts visits only on the published hosts, so local builds and automated checks never send hits.
(() => {
  if (!['clareia.clareia.workers.dev'].includes(location.hostname)) return;
  const beacon = document.createElement('script');
  beacon.defer = true;
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: '030d6dee34ac4ccf916594e1297fff11' });
  document.head.append(beacon);
})();
