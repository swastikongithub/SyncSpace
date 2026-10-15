import { createBrowserRouter } from 'react-router';
import { InvitePage } from '../features/auth/InvitePage.jsx';
import { AuthLayout, RegisterPage, SignInPage } from '../features/auth/AuthPages.jsx';
import { MembersPage } from '../features/members/MembersPage.jsx';
import { WorkspaceLayout } from '../features/shell/WorkspaceLayout.jsx';
import { TrashPage } from '../features/documents/TrashPage.jsx';
import { WorkspaceHome } from '../features/workspaces/WorkspaceHome.jsx';
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage.jsx';
import { Home, NotFound, RequireUser, RootLayout, RouteError } from './RootLayout.jsx';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      {
        element: <AuthLayout />,
        children: [
          { path: '/signin', element: <SignInPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      { path: '/invite/:token', element: <InvitePage /> },
      {
        element: <RequireUser />,
        children: [
          { path: '/w', element: <WorkspacesPage /> },
          {
            path: '/w/:workspaceId',
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <WorkspaceHome /> },
              {
                path: 'd/:docId',
                lazy: async () => ({ Component: (await import('../features/documents/DocumentPage.jsx')).DocumentPage }),
              },
              { path: 'members', element: <MembersPage /> },
              { path: 'trash', element: <TrashPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
