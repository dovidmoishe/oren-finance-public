import { AppProviders } from "../providers";
import { PersonalizedIntl } from "@/i18n/personalized-intl";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <AppProviders>{children}</AppProviders>
    </PersonalizedIntl>
  );
}
