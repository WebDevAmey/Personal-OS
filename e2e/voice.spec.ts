// e2e/voice.spec.ts — voice input lands in the editable field and is never
// auto-submitted (ADR-015, FR-501..505). The browser's SpeechRecognition is
// replaced by a scripted fake; everything after the transcript is real.
import { expect, test } from '@playwright/test';
import { USERS } from './support/config';
import { count, paletteInput, signIn, sql, userId } from './support/helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      lang = 'en-US';
      continuous = false;
      interimResults = true;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onsoundstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onnomatch: (() => void) | null = null;
      onend: (() => void) | null = null;
      private ended = false;
      start() {
        (window as unknown as { __voiceStarts: number }).__voiceStarts = ((window as unknown as { __voiceStarts?: number }).__voiceStarts ?? 0) + 1;
        const result = (text: string, isFinal: boolean) => {
          const alt = { transcript: text, confidence: 0.9 };
          return { resultIndex: 0, results: { length: 1, 0: { isFinal, length: 1, 0: alt } } };
        };
        setTimeout(() => {
          this.onstart?.();
          this.onspeechstart?.();
          this.onresult?.(result('add a task', false));
        }, 50);
        setTimeout(() => this.onresult?.(result('add a task to buy milk', true)), 150);
        setTimeout(() => this.stop(), 250);
      }
      stop() {
        if (this.ended) return;
        this.ended = true;
        this.onspeechend?.();
        this.onend?.();
      }
      abort() {
        this.stop();
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
  });
});

test('final transcript fills the input, is not submitted, and runs only after the user edits and presses Enter', async ({ page }) => {
  const uid = await userId(USERS.voice);
  const commandPosts: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/command' && r.method() === 'POST') commandPosts.push(r.postData() ?? '');
  });

  await signIn(page, USERS.voice);
  await page.goto('/today');
  await page.getByRole('button', { name: 'Speak a command' }).click();

  const input = paletteInput(page);
  await expect(input).toHaveValue('add a task to buy milk');
  await expect(input).toBeEditable();
  await expect(page.getByText('Press Enter to run, or edit first.')).toBeVisible();
  // Give an auto-submit every chance to happen; none may.
  await page.waitForTimeout(1500);
  expect(commandPosts).toHaveLength(0);
  expect(await count('SELECT 1 FROM "AgentRun" WHERE "userId" = $1', [uid])).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __voiceStarts: number }).__voiceStarts)).toBe(1);

  // Edit: "milk" → "oat milk", then submit. The transcript arrives selected;
  // ArrowRight collapses the selection to the end (cmdk takes Home/End for the list).
  await input.press('ArrowRight');
  for (let i = 0; i < 'milk'.length; i++) await input.press('Backspace');
  await input.pressSequentially('oat milk');
  await expect(input).toHaveValue('add a task to buy oat milk');
  await input.press('Enter');

  await expect(page.getByRole('dialog', { name: 'Command bar' }).getByRole('region', { name: 'Done' })).toBeVisible();
  expect(commandPosts).toHaveLength(1);
  expect(JSON.parse(commandPosts[0])).toMatchObject({ input: 'add a task to buy oat milk', source: 'voice' });
  const created = await sql<{ title: string }>('SELECT title FROM "Task" WHERE "userId" = $1', [uid]);
  expect(created.map((t) => t.title)).toEqual(['buy oat milk']);
  const [run] = await sql<{ modality: string }>('SELECT modality::text FROM "AgentRun" WHERE "userId" = $1', [uid]);
  expect(run.modality).toBe('VOICE');
});
