export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-[var(--content-max)] px-4 py-6 sm:px-6 lg:py-8" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-8 flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
