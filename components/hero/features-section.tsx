'use client';

import { useEffect, useState, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  CheckCircle,
  Command,
  Shield,
} from 'lucide-react';

function LottieAnimation({ src, className }: { src: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let anim: any = null;

    async function load() {
      try {
        const lottie = await import('lottie-web');
        if (cancelled || !containerRef.current) return;

        const res = await fetch(src);
        const data = await res.json();

        anim = lottie.default.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: data,
        });
      } catch (e) {
        console.error('Lottie load error:', e);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (anim) anim.destroy();
    };
  }, [src]);

  return <div ref={containerRef} className={className} />;
}

function AnimatedCard({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      } ${className}`}
    >
      {children}
    </div>
  );
}

function CommandBarDemo() {
  const [input, setInput] = useState('');
  const fullText = 'Move the assignment to Friday and remind me after lunch';
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    let i = 0;
    let timeout: NodeJS.Timeout;
    const type = () => {
      if (i <= fullText.length) {
        setInput(fullText.slice(0, i));
        i++;
        timeout = setTimeout(type, 45);
      } else {
        timeout = setTimeout(() => {
          setInput('');
          i = 0;
          type();
        }, 3000);
      }
    };
    type();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 sm:px-6">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-violet-200/60 bg-white/80 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/50 px-3 py-2">
          <Command className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-[11px] font-medium text-violet-600">Command Bar</span>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
            <span className="flex-1 text-xs text-neutral-700">
              {input}
              <span
                className={`inline-block h-3.5 w-0.5 bg-violet-500 ${
                  cursorVisible ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-600">
              <CheckCircle className="h-3 w-3 text-emerald-500" />
              <span>Moved to Friday</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-600">
              <CheckCircle className="h-3 w-3 text-emerald-500" />
              <span>Reminder set for 1:00 PM</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefingDemo() {
  const items = [
    { time: '9:00 AM', title: 'Team standup', type: 'calendar', icon: '📅' },
    { time: '11:30 AM', title: 'Reply to recruiter email', type: 'email', icon: '✉️' },
    { time: '2:00 PM', title: 'Finish API integration', type: 'task', icon: '⚡' },
    { time: '4:00 PM', title: 'Review PR #42', type: 'task', icon: '✅' },
    { time: '5:30 PM', title: 'Call with Rahul', type: 'calendar', icon: '📞' },
  ];

  const [visibleItems, setVisibleItems] = useState<number[]>([]);

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < items.length) {
        setVisibleItems((prev) => [...prev, index]);
        index++;
      } else {
        index = 0;
        setVisibleItems([]);
      }
    }, 800);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden px-4 sm:px-6">
      <div className="relative mt-2 min-h-0 flex-1 space-y-2 overflow-hidden">
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-xl border border-blue-100/60 bg-white/80 p-2.5 shadow-sm backdrop-blur-sm transition-all duration-500 ${
              visibleItems.includes(i)
                ? 'translate-y-0 opacity-100'
                : 'translate-y-4 opacity-0'
            }`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm">
              {item.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-neutral-800">{item.title}</p>
              <p className="text-[10px] text-neutral-500">{item.time}</p>
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-blue-50/80 to-transparent" />
      </div>
    </div>
  );
}

function EmailDemo() {
  const emails = [
    { from: 'Alex', subject: 'Re: Project Update', snippet: 'Looks good, let\'s ship it...' },
    { from: 'GitHub', subject: 'PR #42 approved', snippet: 'Your pull request has been...' },
    { from: 'Sarah', subject: 'Meeting notes', snippet: 'Here are the key takeaways...' },
  ];

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-4 sm:px-6">
      <div className="space-y-2">
        {emails.map((e, i) => (
          <div
            key={i}
            className="rounded-lg border border-emerald-100/60 bg-white/70 p-2.5 shadow-sm backdrop-blur-sm"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                {e.from[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-neutral-800">{e.from}</p>
                <p className="truncate text-[10px] text-neutral-500">{e.subject}</p>
              </div>
            </div>
            <p className="mt-1.5 truncate text-[10px] text-neutral-400">{e.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShieldDemo() {
  const tools = [
    { name: 'create_task', status: 'validated' },
    { name: 'search_email', status: 'validated' },
    { name: 'update_task', status: 'validated' },
    { name: 'save_memory', status: 'validated' },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 sm:px-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100">
        <Shield className="h-8 w-8 text-rose-500" />
      </div>
      <div className="w-full space-y-1.5">
        {tools.map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-rose-100/60 bg-white/70 px-3 py-2 shadow-sm backdrop-blur-sm"
          >
            <code className="text-[10px] text-neutral-700">{t.name}</code>
            <Badge variant="secondary" className="h-5 px-1.5 text-[9px] bg-emerald-50 text-emerald-700">
              ✓ Zod
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeaturesSection() {
  return (
    <section id="features" className="bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge variant="secondary" className="mb-4">
            Features
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl md:text-5xl">
            Everything for your productivity
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-600">
            A beautiful, integrated toolkit designed for focused work.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-16 md:grid-cols-3">
          {/* AI Command Bar - tall card */}
          <AnimatedCard delay={0} className="flex flex-col overflow-hidden rounded-[28px] border border-violet-200/50 bg-violet-50/60 md:row-span-2">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#7B35F0]">Natural language</span>
                  <span className="block text-[#17152A]">command bar</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                Type or speak what you need. Create tasks, reschedule meetings, 
                search emails, all in one turn.
              </p>
            </div>
            <div className="min-h-[300px]">
              <CommandBarDemo />
            </div>
          </AnimatedCard>

          {/* Daily Briefing */}
          <AnimatedCard delay={100} className="flex flex-col overflow-hidden rounded-[28px] border border-blue-200/50 bg-blue-50/60">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#0586d2]">AI-powered</span>
                  <span className="block text-[#17152A]">morning briefing</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                See what needs your attention before you start your day.
              </p>
            </div>
            <div className="relative min-h-[220px] overflow-hidden">
              <BriefingDemo />
            </div>
          </AnimatedCard>

          {/* Memory Search */}
          <AnimatedCard delay={200} className="flex flex-col overflow-hidden rounded-[28px] border border-amber-200/50 bg-amber-50/60">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#c64e27]">Semantic memory</span>
                  <span className="block text-[#17152A]">search</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                Find anything you&apos;ve saved using meaning, not just keywords.
              </p>
            </div>
            <div className="relative min-h-[220px] overflow-hidden">
              <LottieAnimation
                src="/lottie/memory.json"
                className="absolute inset-0 h-full w-full scale-110"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-amber-50/80 to-transparent" />
            </div>
          </AnimatedCard>

          {/* Email Intelligence */}
          <AnimatedCard delay={300} className="flex flex-col overflow-hidden rounded-[28px] border border-emerald-200/50 bg-emerald-50/60">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#359462]">Email intelligence</span>
                  <span className="block text-[#17152A]">built in</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                Search, read, and draft emails through Gmail without leaving the app.
              </p>
            </div>
            <div className="min-h-[220px]">
              <EmailDemo />
            </div>
          </AnimatedCard>

          {/* Calendar Integration */}
          <AnimatedCard delay={400} className="flex flex-col overflow-hidden rounded-[28px] border border-purple-200/50 bg-purple-50/60">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#5e2ac4]">Calendar integration</span>
                  <span className="block text-[#17152A]">at a glance</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                View your Google Calendar events directly from the command bar.
              </p>
            </div>
            <div className="relative min-h-[220px] overflow-hidden">
              <LottieAnimation
                src="/lottie/calendar.json"
                className="absolute inset-0 h-full w-full scale-110"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-purple-50/80 to-transparent" />
            </div>
          </AnimatedCard>

          {/* Type-Safe Tools */}
          <AnimatedCard delay={500} className="flex flex-col overflow-hidden rounded-[28px] border border-rose-200/50 bg-rose-50/60">
            <div className="flex-1 p-6 sm:p-8">
              <div className="[&_h3]:leading-[1.18]">
                <h3 className="text-[22px] font-medium leading-[1.08] tracking-[-0.04em] text-[#151515] sm:text-[28px] sm:leading-[1.05] sm:tracking-[-0.045em]">
                  <span className="block text-[#e11d48]">Type-safe AI tools</span>
                  <span className="block text-[#17152A]">every action audited</span>
                </h3>
              </div>
              <p className="mt-3 max-w-[360px] text-[13.5px] font-medium leading-[1.42] tracking-[-0.02em] text-[#6D6878] sm:text-[15px] sm:leading-[1.45] sm:tracking-[-0.025em]">
                Every AI action validated with Zod schemas. No rogue mutations.
              </p>
            </div>
            <div className="min-h-[220px]">
              <ShieldDemo />
            </div>
          </AnimatedCard>
        </div>
      </div>
    </section>
  );
}

export { LottieAnimation };
