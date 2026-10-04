import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Store as BrokenStore } from './broken.jsx';
import { Store as FixedStore } from './fixed.jsx';

// ?variant=broken (default) | fixed | wrong   ?strict=1 wraps the app in StrictMode
// ?cost=N   makes every render N times more expensive (timing tests)
// ?api=URL  fetches URL on load and shows the answer (network replay tests)
// ?rum=1    reports Core Web Vitals to /__vitals with the real-user reporter asset
const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') || 'broken';
const store =
  variant === 'fixed' ? <FixedStore /> : variant === 'wrong' ? <FixedStore suggestionLimit={3} /> : <BrokenStore />;

function ApiAnswer({ url }) {
  const [answer, setAnswer] = useState('loading');
  useEffect(() => {
    fetch(url)
      .then((response) => response.json())
      .then((data) => setAnswer(String(data.count)))
      .catch(() => setAnswer('failed'));
  }, [url]);
  return <p data-testid="api-answer">API answer: {answer}</p>;
}

const api = params.get('api');
const app = api ? (
  <>
    {store}
    <ApiAnswer url={api} />
  </>
) : (
  store
);

if (params.get('rum') === '1') {
  import('../../../skills/optimize-renders/assets/web-vitals-reporter.js').then(({ reportWebVitals }) => {
    reportWebVitals({ endpoint: '/__vitals', release: params.get('release') || 'lab' });
    window.__rumReady = true;
  });
}

createRoot(document.getElementById('root')).render(params.get('strict') === '1' ? <StrictMode>{app}</StrictMode> : app);
