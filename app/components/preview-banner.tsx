export function PreviewBanner() {
  if (process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'preview') return null;
  return (
    <aside aria-label="Preview environment" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, padding: '8px 16px', background: '#18181b', color: '#fff', fontSize: 12, textAlign: 'center' }}>
      Preview PR #{process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER} · {process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7)} · Financial execution disabled · <a href="/_preview/logout" style={{ textDecoration: 'underline' }}>Lock preview</a>
    </aside>
  );
}
