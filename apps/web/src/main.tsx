import '@inkadra/ui/styles.css';
import './i18n/index.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { BoardPage } from './board/BoardPage.tsx';
import { SessionProvider, useSession } from './lib/session.tsx';
import { AppLayout } from './routes/AppLayout.tsx';
import { Diagnostics } from './routes/Diagnostics.tsx';
import { Home } from './routes/Home.tsx';
import { Login } from './routes/Login.tsx';
import { NotFound } from './routes/NotFound.tsx';

function Root() {
  const { loading } = useSession();
  if (loading) return null;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/diagnostics', element: <Diagnostics /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'p/:projectId', element: <BoardPage /> },
          { path: 'p/:projectId/b/:boardId', element: <BoardPage /> },
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
