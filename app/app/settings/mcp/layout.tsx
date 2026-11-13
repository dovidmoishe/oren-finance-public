import { AppProviders } from '../../providers';
import { PersonalizedIntl } from '@/i18n/personalized-intl';

export default function McpSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PersonalizedIntl>
      <AppProviders>{children}</AppProviders>
    </PersonalizedIntl>
  );
}
