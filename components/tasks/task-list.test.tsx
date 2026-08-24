import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskList } from './task-list';

describe('TaskList', () => {
  it('renders each task\'s title and due date', () => {
    render(<TaskList tasks={[
      { id: '1', userId: 'u1', title: 'Reply to recruiter', notes: null, dueDate: new Date('2026-08-25'), status: 'open', completedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ]} />);
    expect(screen.getByText('Reply to recruiter')).toBeInTheDocument();
  });

  it('shows an empty state when there are no open tasks', () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText(/nothing on your list/i)).toBeInTheDocument();
  });
});
