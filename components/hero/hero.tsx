'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FeaturesSection } from './features-section';
import { FaqAccordion } from '@/components/ui/faq-accordion';
import { LottieAnimation } from './features-section';
import { RandomLetterSwap } from '@/components/ui/random-letter-swap';
import {
  Sparkles,
  ArrowRight,
  Layers,
} from 'lucide-react';

export function Hero() {
  return (
    <main className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="fixed top-0 z-50 w-full border-b border-neutral-100 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold text-neutral-900">Personal OS</span>
          </div>
          <div className="flex items-center gap-8">
            <Link
              href="/#features"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RandomLetterSwap
                className="cursor-pointer font-medium text-neutral-600 text-sm hover:text-neutral-900"
                label="Features"
                staggerDuration={0.025}
                transition={{ duration: 0.6, type: "spring" }}
              />
            </Link>
            <Link
              href="/#how-it-works"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RandomLetterSwap
                className="cursor-pointer font-medium text-neutral-600 text-sm hover:text-neutral-900"
                label="How It Works"
                staggerDuration={0.025}
                transition={{ duration: 0.6, type: "spring" }}
              />
            </Link>
            <Link
              href="/#faq"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RandomLetterSwap
                className="cursor-pointer font-medium text-neutral-600 text-sm hover:text-neutral-900"
                label="FAQ"
                staggerDuration={0.025}
                transition={{ duration: 0.6, type: "spring" }}
              />
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/api/auth/signin"
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RandomLetterSwap
                className="cursor-pointer font-medium text-neutral-600 text-sm hover:text-neutral-900"
                label="Sign in"
                staggerDuration={0.025}
                transition={{ duration: 0.6, type: "spring" }}
              />
            </Link>
            <Link
              href="/api/auth/signin"
              className={buttonVariants({ size: 'sm', className: 'rounded-full' })}
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.15),transparent)]" />
        <div className="relative mx-auto max-w-6xl text-center">
          <Badge variant="secondary" className="mb-6 gap-2">
            <Sparkles className="h-3 w-3" />
            AI-Powered Productivity
          </Badge>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-neutral-900 sm:text-6xl lg:text-7xl">
            Your day, managed by
            <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              {' '}one command
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-neutral-600">
            A personal operating system that reads your email, calendar, and tasks, then lets you manage everything through a single command bar. Type or speak, and it just happens.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/api/auth/signin"
              className={buttonVariants({ size: 'lg', className: 'rounded-full px-8' })}
            >
              Start for Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full px-8"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              See How It Works
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <FeaturesSection />

      {/* How It Works */}
      <section id="how-it-works" className="bg-white py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <Badge variant="secondary" className="mb-4">
              How It Works
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
              Your daily rhythm
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-border/70 overflow-hidden pt-0">
              <CardContent className="px-0">
                <div className="aspect-[4/3] w-full flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
                  <LottieAnimation
                    src="/lottie/morning.json"
                    className="h-48 w-full"
                  />
                </div>
              </CardContent>
              <CardHeader>
                <CardTitle>Morning Briefing</CardTitle>
                <CardDescription className="leading-6">
                  AI summarizes what needs your attention before you start your day. Emails, meetings, and tasks, all in one view.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="border-border/70 overflow-hidden pt-0">
              <CardContent className="px-0">
                <div className="aspect-[4/3] w-full flex items-center justify-center bg-gradient-to-br from-violet-50 to-purple-50">
                  <LottieAnimation
                    src="/lottie/command.json"
                    className="h-48 w-full"
                  />
                </div>
              </CardContent>
              <CardHeader>
                <CardTitle>Command Anything</CardTitle>
                <CardDescription className="leading-6">
                  Reschedule meetings, create tasks, search emails, just type or speak naturally. No special syntax needed.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="border-border/70 overflow-hidden pt-0">
              <CardContent className="px-0">
                <div className="aspect-[4/3] w-full flex items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50">
                  <LottieAnimation
                    src="/lottie/evening.json"
                    className="h-48 w-full"
                  />
                </div>
              </CardContent>
              <CardHeader>
                <CardTitle>Evening Wrap-up</CardTitle>
                <CardDescription className="leading-6">
                  AI logs what was accomplished and preps for tomorrow. Stay organized without the overhead.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 px-4 bg-white">
        <FaqAccordion
          title="Frequently Asked Questions"
          items={[
            {
              question: "What is Personal OS?",
              answer: "Personal OS is an AI-powered personal operating system that manages your tasks, emails, and calendar through a single command bar. Type or speak naturally, and it just happens."
            },
            {
              question: "How does the AI command bar work?",
              answer: "Simply type or speak what you need in natural language. The AI understands context and can create tasks, reschedule meetings, search emails, and much more, all in one turn."
            },
            {
              question: "What integrations are supported?",
              answer: "We currently support Gmail, Google Calendar, and Google Tasks. More integrations are coming soon based on user feedback."
            },
            {
              question: "Is my data secure?",
              answer: "Yes! We use industry-standard encryption and OAuth 2.0 authentication. Your data is never stored unnecessarily and you maintain full control."
            },
            {
              question: "How do I get started?",
              answer: "Simply sign in with your Google account and you're ready to go. No setup required, your data is immediately available through the command bar."
            },
            {
              question: "Is there a free tier?",
              answer: "Yes! Personal OS is free to use. We offer premium features for power users who need advanced AI capabilities and additional integrations."
            }
          ]}
        />
      </section>
    </main>
  );
}
