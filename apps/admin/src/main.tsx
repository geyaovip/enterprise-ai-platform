import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@suite/frontend/styles.css';
import { App } from './App';
import { BrandIdentity } from '@suite/frontend/components';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><BrandIdentity/><App /></BrowserRouter></React.StrictMode>);
