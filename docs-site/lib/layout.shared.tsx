import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { OrenLogo } from '@/components/brand/oren-logo';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <div className="inline-flex items-center gap-[10px] text-[15px] font-semibold tracking-[.16em]"><OrenLogo size={28} /><span>OREN</span></div>,
      url: '/docs',
    },
  };
}
