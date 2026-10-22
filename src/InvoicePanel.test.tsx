import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InvoicePanel from './InvoicePanel';
import type { Invoice, Snapshot } from './persistence';

afterEach(cleanup);
const snapshot = (): Snapshot => ({ version: 1, rates: {}, timer: null, entries: [
  { id: 'rated', client: 'Acme', project: 'Website', description: 'Build', startedAt: 1000, endedAt: 3601000, hourlyRate: 60 },
  { id: 'unrated', client: 'Acme', project: 'Admin', description: '', startedAt: 1000, endedAt: 3601000 },
  { id: 'other', client: 'Other client', project: 'Private project', description: '', startedAt: 1000, endedAt: 3601000, hourlyRate: 100 },
] });
describe('invoice selection', () => {
  it('selects only one client, requires a rate choice, and saves with no due date', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<InvoicePanel snapshot={snapshot()} busy={false} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Invoice client'), { target: { value: 'Acme' } });
    expect(screen.queryByText('Private project')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select available' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a non-negative rate');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByLabelText('No charge')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as Invoice;
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines[1].hourlyRate).toBe(0);
    expect(saved.dueDate).toBe('');
  });
  it('labels and disables sessions reserved on another draft', () => {
    const data = snapshot();
    data.invoices = [{ id: 'old', number: 'INV-0001', status: 'draft', client: 'Acme', businessDetails: '', clientDetails: '', issueDate: '2026-10-21', dueDate: '', currency: 'USD', notes: '', lines: [{ ...data.entries[0], hourlyRate: 60 }] }];
    render(<InvoicePanel snapshot={data} busy={false} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Invoice client'), { target: { value: 'Acme' } });
    expect(screen.getByText('On draft INV-0001')).toBeInTheDocument();
    expect(screen.getByLabelText(/Website.*On draft/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select available' }));
    expect(screen.getByText('1 sessions selected')).toBeInTheDocument();
  });
  it('shows save failures without reporting success', async () => {
    render(<InvoicePanel snapshot={snapshot()} busy={false} onSave={vi.fn().mockRejectedValue(new Error('Disk unavailable'))} />);
    fireEvent.change(screen.getByLabelText('Invoice client'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText(/Website.*Build/));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
    expect(screen.queryByText('Invoice draft saved.')).not.toBeInTheDocument();
  });
});
