export default function Home() {
  return (
    <main className="min-h-screen bg-roadwatch-paper text-roadwatch-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7">
        <a className="flex items-center gap-3 font-semibold tracking-tight" href="/">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-roadwatch-forest text-lg text-roadwatch-lime"
          >
            R
          </span>
          <span className="text-lg">RoadWatch</span>
        </a>
        <span className="rounded-full border border-roadwatch-ink/15 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-roadwatch-forest">
          Early prototype
        </span>
      </header>

      <section className="mx-auto grid min-h-[76vh] w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-roadwatch-forest">
            Better roads begin with better signals
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
            Every ride can help make roads{" "}
            <span className="text-roadwatch-forest">safer.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-roadwatch-ink/70">
            RoadWatch is building a community-powered view of road conditions,
            starting with real motion and location data collected on the road.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <span className="rounded-full bg-roadwatch-forest px-6 py-3 text-sm font-semibold text-white">
              Field testing in progress
            </span>
            <span className="text-sm text-roadwatch-ink/60">
              Hardware-first prototype
            </span>
          </div>
        </div>

        <div
          aria-label="RoadWatch sensor data illustration"
          className="relative mx-auto flex aspect-square w-full max-w-md items-center justify-center rounded-[2rem] bg-roadwatch-forest p-8 text-white shadow-2xl shadow-roadwatch-forest/15"
        >
          <div className="absolute inset-5 rounded-[1.5rem] border border-white/15" />
          <div className="relative w-full max-w-xs">
            <div className="mb-8 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/65">
              <span>Live signals</span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-roadwatch-lime" />
                Prototype
              </span>
            </div>
            <div className="flex h-32 items-center gap-2" aria-hidden="true">
              {[30, 52, 38, 74, 46, 90, 57, 42, 68, 34, 82, 50, 64].map(
                (height, index) => (
                  <span
                    key={index}
                    className="w-full rounded-full bg-roadwatch-lime/90"
                    style={{ height: `${height}%` }}
                  />
                ),
              )}
            </div>
            <div className="mt-8 flex justify-between border-t border-white/20 pt-4 text-xs text-white/60">
              <span>Motion</span>
              <span>Location</span>
              <span>Road insight</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-roadwatch-ink/10 px-6 py-6 text-xs text-roadwatch-ink/55 sm:flex-row sm:justify-between">
        <span>RoadWatch — an early-stage road safety project</span>
        <span>Collecting data responsibly, one trip at a time</span>
      </footer>
    </main>
  );
}
