import { AppProviders } from '../../providers';
import { PersonalizedIntl } from '@/i18n/personalized-intl';

export default function McpConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <AppProviders>{children}</AppProviders>
    </PersonalizedIntl>
  );
}
