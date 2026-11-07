import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import i18n from '../i18n/index.ts';
import { Onboarding } from './Onboarding.tsx';

vi.mock('react-router', () => ({ useNavigate: () => () => {} }));
vi.mock('./AppLayout.tsx', () => ({
  useInstanceSetupState: () => ({}),
  useProjects: () => ({ projects: [], canCreateProjects: false }),
}));
vi.mock('./InstanceSetup.tsx', () => ({ InstanceChecklist: () => null }));
vi.mock('./NewProjectDialog.tsx', () => ({ ProjectSetupForm: () => null }));

it('links the clipper tip to the Chrome Web Store', async () => {
  await i18n.changeLanguage('en');
  const html = renderToStaticMarkup(<Onboarding />);
  expect(html).toContain(
    'From the browser, save with <a href="https://chromewebstore.google.com/detail/inkadra-clipper/hdajoikapihpjfbgioeagenmoalckjkh" target="_blank" rel="noopener">Inkadra Clipper ↗</a>',
  );
});
