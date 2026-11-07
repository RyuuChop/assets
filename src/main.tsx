import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { ErrorBoundary } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Grandmaster 3D Chess Studio">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
