import { Button, EmptyState } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSession } from '../lib/session.tsx';
import { useProjects } from './AppLayout.tsx';
import './home.css';

function greetingKey(hour: number) {
  if (hour < 13) return 'home.greeting.morning';
  if (hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { projects, shared, openNewProject } = useProjects();
  const navigate = useNavigate();
  const now = new Date();
  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <div style={{ padding: '30px 32px', maxWidth: 1104 }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {t(greetingKey(now.getHours()), { name: firstName })}
      </h1>
      <div className="ink-muted" style={{ marginTop: 6 }}>
        {now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="ink-label">{t('home.recent')}</span>
        <div style={{ marginTop: 12 }}>
          {projects && projects.length > 0 && (
            <div className="home__recent">
              {[...projects]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 8)
                .map((p) => (
                  <a
                    key={p.id}
                    href={`/p/${p.id}`}
                    className="ink-card home__card"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/p/${p.id}`);
                    }}
                  >
                    <span className="home__cover" />
                    <span className="home__meta">
                      <span className="home__name">{p.name}</span>
                      <span className="ink-muted home__when">
                        {new Date(p.updatedAt).toLocaleDateString(i18n.language, {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </span>
                  </a>
                ))}
            </div>
          )}
          {projects && projects.length === 0 && (shared?.length ?? 0) === 0 && (
            <EmptyState
              icon="board"
              title={t('home.noProjects')}
              actions={
                <Button variant="primary" icon="plus" onClick={openNewProject}>
                  {t('nav.newProject')}
                </Button>
              }
            >
              {t('home.noProjectsBody')}
            </EmptyState>
          )}
        </div>
      </div>

      {shared && shared.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <span className="ink-label">{t('home.shared')}</span>
          <div className="home__recent" style={{ marginTop: 12 }}>
            {shared.map((b) => (
              <a
                key={b.id}
                href={`/p/${b.projectId}/b/${b.id}`}
                className="ink-card home__card"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/p/${b.projectId}/b/${b.id}`);
                }}
              >
                <span className="home__cover" />
                <span className="home__meta">
                  <span className="home__name">{b.title}</span>
                  <span className="ink-muted home__when">{t(`roles.${b.myRole}`)}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
