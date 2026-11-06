import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@stex/design-system/stex.css';
import './styles/igor.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Igor: #root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
