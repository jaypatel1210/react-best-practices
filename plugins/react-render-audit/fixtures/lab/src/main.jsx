import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Store as BrokenStore } from './broken.jsx';
import { Store as FixedStore } from './fixed.jsx';

// ?variant=broken (default) | fixed | wrong   ?strict=1 wraps the app in StrictMode
const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') || 'broken';
const app =
  variant === 'fixed' ? <FixedStore /> : variant === 'wrong' ? <FixedStore suggestionLimit={3} /> : <BrokenStore />;

createRoot(document.getElementById('root')).render(params.get('strict') === '1' ? <StrictMode>{app}</StrictMode> : app);
