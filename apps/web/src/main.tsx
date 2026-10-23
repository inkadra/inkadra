import '@inkadra/ui/styles.css';
import './i18n/index.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { SessionProvider, useSession } from './lib/session.tsx';
import { AppLayout } from './routes/AppLayout.tsx';
import { Authorize } from './routes/Authorize.tsx';
import { Diagnostics } from './routes/Diagnostics.tsx';
import { Home } from './routes/Home.tsx';
import { Join } from './routes/Join.tsx';
import { Login } from './routes/Login.tsx';
import { NotFound } from './routes/NotFound.tsx';
import { ResetPassword } from './routes/ResetPassword.tsx';
import { Settings } from './routes/Settings.tsx';

function Root() {
  const { loading } = useSession();
  if (loading) return null;
  return <Outlet />;
}

const loadBoard = async () => ({ Component: (await import('./board/BoardPage.tsx')).BoardPage });

const router = createBrowserRouter([
  {
    element: <Root />,
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
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
