import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), sdk: vi.fn() }));
vi.mock('./persistence', () => ({ hosted: true, loadSnapshot: mocks.load, saveSnapshot: mocks.save, getCartridgeSdk: mocks.sdk }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ version: 1, entries: [], rates: {}, timer: null });
  mocks.save.mockResolvedValue(undefined);
});
it('opens invoices without registering experimental voice actions', async () => {
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Invoices' });
  fireEvent.click(button);
  expect(screen.getByLabelText('Due date (optional)')).toBeInTheDocument();
  expect(screen.queryByText(/Voice control/)).not.toBeInTheDocument();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('preserves manual entry and invoice navigation', async () => {
  render(<App />);
  await screen.findByRole('button', { name: 'Manual entry' });
  await waitFor(() => expect(screen.getByText(/Mnemosyne.*Saved/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Example Client' } });
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'Example Project' } });
  fireEvent.click(screen.getByRole('button', { name: 'Manual entry' }));
  fireEvent.change(screen.getByLabelText('Start date & time'), { target: { value: '2026-10-21T09:00' } });
  fireEvent.change(screen.getByLabelText('End date & time'), { target: { value: '2026-10-21T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual entry' }));
  await waitFor(() => expect(mocks.save.mock.calls.at(-1)![0].entries).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Invoices' }));
  expect(screen.getByRole('option', { name: 'Example Client' })).toBeInTheDocument();
});
