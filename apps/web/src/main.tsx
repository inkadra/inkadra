import '@inkadra/ui/styles.css';
import './i18n/index.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { SessionProvider, useSession } from './lib/session.tsx';
import { registerServiceWorker } from './pwa/register.ts';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppLayout } from './routes/AppLayout.tsx';
import { Authorize } from './routes/Authorize.tsx';
import { Diagnostics } from './routes/Diagnostics.tsx';
import { ErrorPage } from './routes/ErrorPage.tsx';
import { Home } from './routes/Home.tsx';
import { Join } from './routes/Join.tsx';
import { Login } from './routes/Login.tsx';
import { NotFound } from './routes/NotFound.tsx';
import { Onboarding } from './routes/Onboarding.tsx';
import { Projects } from './routes/Projects.tsx';
import { ResetPassword } from './routes/ResetPassword.tsx';
import { Settings } from './routes/Settings.tsx';

function Root() {
  const { loading } = useSession();
  if (loading) return null;
  return <Outlet />;
}

const loadBoard = async () => ({ Component: (await import('./board/BoardPage.tsx')).BoardPage });
const loadGuest = async () => ({ Component: (await import('./guest/GuestPage.tsx')).GuestPage });

const router = createBrowserRouter([
  // The guest page of a share link (decision 0013): outside the account session, which it
  // never loads. The path is the one the server puts in ShareLink.url.
  { path: '/s/:token', lazy: loadGuest, errorElement: <ErrorPage /> },
  {
    element: (
      <SessionProvider>
        <Root />
      </SessionProvider>
    ),
    errorElement: <ErrorPage />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/diagnostics', element: <Diagnostics /> },
      { path: '/join/:token', element: <Join /> },
      { path: '/authorize', element: <Authorize /> },
      { path: '/reset-password', element: <ResetPassword /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'projects', element: <Projects /> },
          { path: 'onboarding', element: <Onboarding /> },
          { path: 'settings', element: <Settings /> },
          // The board editor (Yjs, Tiptap, uploads) loads with the first board opened.
          { path: 'p/:projectId', lazy: loadBoard },
          { path: 'p/:projectId/b/:boardId', lazy: loadBoard },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdatePrompt />
  </StrictMode>,
);
registerServiceWorker();
