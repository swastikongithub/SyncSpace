import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './app/auth.jsx';
import { LocalDataProvider } from './app/local-data.jsx';
import { router } from './app/router.jsx';
import { AnnouncerProvider } from './ui/Announcer.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AnnouncerProvider>
      <AuthProvider>
        <LocalDataProvider>
          <RouterProvider router={router} />
        </LocalDataProvider>
      </AuthProvider>
    </AnnouncerProvider>
  </StrictMode>,
);
