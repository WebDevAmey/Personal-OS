import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefingView } from './briefing-view';

describe('BriefingView', () => {
  it('renders attention and digest items from the briefing', () => {
    render(<BriefingView briefing={{
      id: '1', userId: 'u1', briefingDate: '2026-08-24',
      attentionItems: ['Reply to recruiter'], digestItems: ['Speculative decoding trended today'],
      generatedAt: new Date(),
    }} />);
    expect(screen.getByText('Reply to recruiter')).toBeInTheDocument();
    expect(screen.getByText('Speculative decoding trended today')).toBeInTheDocument();
  });

  it('shows a waiting state when no briefing has been generated yet', () => {
    render(<BriefingView briefing={null} />);
    expect(screen.getByText(/briefing is being prepared/i)).toBeInTheDocument();
  });
});
