import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './shared/styles/app.css';
import './shared/styles/workbench.css';
import './shared/styles/datasets.css';
import './shared/styles/models.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
