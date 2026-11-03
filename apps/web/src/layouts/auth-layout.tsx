import type { PropsWithChildren } from 'react';

export function AuthLayout({
  children,
  title,
  eyebrow,
  description,
}: PropsWithChildren<{ title: string; eyebrow: string; description: string }>) {
  return (
    <div className="flex min-h-svh flex-col bg-[#f3f6f4] text-slate-900">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <div className="flex items-center gap-3 font-semibold tracking-tight text-slate-900">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-teal-800 text-sm text-white"
          >
            N
          </span>
          NestJS Agent
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-6 sm:px-10 sm:py-10">
        <div className="grid w-full max-w-[1000px] overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-xl shadow-teal-950/5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative hidden flex-col justify-between overflow-hidden bg-[#124b45] p-12 text-white lg:flex">
            <div className="relative z-10">
              <p className="mb-7 text-xs font-medium tracking-[0.22em] text-teal-200">
                NESTJS AGENT
              </p>
              <p className="text-4xl leading-snug font-semibold tracking-tight">
                每一个想法，
                <br />
                都有新的开始。
              </p>
              <p className="mt-5 text-sm leading-7 text-teal-100/80">
                进入你的工作空间，
                <br />
                从这里开始构建你的应用。
              </p>
            </div>

            <div aria-hidden="true" className="relative my-10 h-40">
              <div className="absolute top-0 left-5 size-56 rounded-full border border-teal-200/20" />
              <div className="absolute top-7 left-12 size-42 rounded-full border border-teal-200/30" />
              <div className="absolute top-14 left-19 size-28 rounded-full border border-teal-200/40 bg-teal-200/5" />
              <div className="absolute top-[102px] left-[122px] size-5 rounded-full bg-teal-200 shadow-[0_0_48px_12px_#99f6e422]" />
              <div className="absolute top-7 left-[245px] size-2 rounded-full bg-teal-200/70" />
            </div>

            <p className="relative z-10 mt-8 text-xs tracking-wider text-teal-100/60">
              保持好奇，专注创造。
            </p>
          </div>

          <section aria-labelledby="auth-title" className="px-7 py-12 sm:px-14 sm:py-16 lg:py-20">
            <div className="mx-auto max-w-sm">
              <p className="mb-3 text-sm font-medium text-teal-700">{eyebrow}</p>
              <h1 id="auth-title" className="text-3xl font-semibold tracking-tight">
                {title}
              </h1>
              <p className="mt-3 mb-9 text-sm leading-6 text-slate-500">{description}</p>
              {children}
            </div>
          </section>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs tracking-wide text-slate-400">
        NestJS Agent
      </footer>
    </div>
  );
}
