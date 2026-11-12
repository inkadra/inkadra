import { MODULE_IDS } from '@inkadra/shared';
import { Icon, kindStyle, Switch } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { MODULE_GLYPHS, setModule, useModules } from '../lib/modules.ts';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row } from './settings-ui.tsx';

/**
 * Settings → Modules (decision 0121): one switch per module, for this person only. Board is
 * always on. Off hides the ways to create, never what exists.
 */
export function ModuleSettings() {
  const { t } = useTranslation();
  const { isOn } = useModules();
  return (
    <Card tour="modules">
      <div className="settings-rows module-settings">
        <Row
          leading={
            <span className="module-settings__glyph" style={kindStyle('board')} aria-hidden="true">
              <Icon name="board" size={16} />
            </span>
          }
          label={t('modules.names.board')}
          help={t('modules.desc.board')}
        >
          <Badge>{t('modules.always')}</Badge>
        </Row>
        {MODULE_IDS.map((id) => {
          const on = isOn(id);
          const name = t(`modules.names.${id}`);
          return (
            <Row
              key={id}
              leading={
                <span
                  className="module-settings__glyph"
                  style={MODULE_GLYPHS[id].style}
                  aria-hidden="true"
                >
                  <Icon name={MODULE_GLYPHS[id].icon} size={16} />
                </span>
              }
              label={name}
              help={
                <>
                  {t(`modules.desc.${id}`)}
                  <span className="module-settings__keep">
                    {on ? t(`modules.keep.${id}`) : t('modules.offKeep', { text: t(`modules.keep.${id}`) })}
                  </span>
                </>
              }
            >
              <Switch
                aria-label={name}
                checked={on}
                onChange={(e) => void trackSave(setModule(id, e.target.checked)).catch(() => {})}
              />
            </Row>
          );
        })}
      </div>
    </Card>
  );
}
