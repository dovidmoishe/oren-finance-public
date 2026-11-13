// Server-rendered placeholder shown while the app's JavaScript loads. It must
// stay free of client components so it can appear before any of them arrive.
function Block({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[20px] bg-panel-subtle ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95">
        <div className="mx-auto grid min-h-[var(--app-nav-height,4.5rem)] max-w-[1540px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Block className="h-7 w-7 rounded-full" />
            <span className="font-display text-lg font-semibold">Oren</span>
          </div>
          <div className="hidden items-center justify-center gap-8 md:flex">
            {[0, 1, 2, 3, 4, 5].map((item) => <Block className="h-3.5 w-16 rounded-full" key={item} />)}
          </div>
          <Block className="h-9 w-20 justify-self-end rounded-full" />
        </div>
      </header>
      <main className="min-w-0 px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-[1540px] pb-20" role="status">
          <span className="sr-only">Loading Oren…</span>
          <Block className="h-[min(560px,70vh)] w-full rounded-[24px]" />
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Block className="h-56" />
            <Block className="h-56" />
          </div>
        </div>
      </main>
    </div>
  );
}
