/**
 * Lets the general ledger screens (routes/finances.js) refuse to change payroll records directly,
 * so payroll runs, payslips and the ledger never drift apart.
 */
export async function findPayrollOwnerOfEntry(executor, entryId) {
  const [[row]] = await executor.execute(
    `SELECT 'run' AS kind FROM payroll_runs WHERE accrual_journal_entry_id = ?
     UNION ALL SELECT 'payment' FROM payroll_lines WHERE payment_journal_entry_id = ?
     UNION ALL SELECT 'thirteenth' FROM payroll_lines WHERE thirteenth_payment_journal_entry_id = ?
     LIMIT 1`,
    [entryId, entryId, entryId],
  );
  return row?.kind || null;
}
