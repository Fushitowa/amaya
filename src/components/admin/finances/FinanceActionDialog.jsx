import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiRequest } from "../../../utils/api.js";
import { peso, round2, manilaToday, withWarnings } from "../../../utils/financeFormat.js";
import { EXPENSE_NAV_CATEGORIES, EXPENSE_NAV_TREE } from "../../../config/expenseNavigation.js";
import { isManualExpenseAccount } from "./financeAccounts.js";
import FinDialog from "./FinDialog.jsx";

// Plain names for accounts that sit beside more specific siblings inside one sidebar category,
// where the chart-of-accounts name would just repeat the folder ("Utilities" under Utilities).
const SPLIT_ACCOUNT_LABELS = Object.freeze({
  "6130": "General utilities",
  "6140": "General supplies",
  "6010": "Other running costs",
});

function createFinClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    throw new Error("Cryptographic random generator is unavailable.");
  }
  return `fin-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The money pop-ups: record an expense, pay a bill or tax, equipment wear & tear, income tax,
 * owner withdrawal, owner money added, and moving money between accounts. The page opens one with
 * `ref.current.open(mode)`; everything the form needs lives here.
 */
export default function FinanceActionDialog({
  ref,
  coaAccounts,
  openPayables,
  payablesTotals,
  liquidAccountOptions,
  withCode,
  netIncomePin,
  pnlData,
  onPnlRefreshed,
  buildDateParams,
  grossEquip1510,
  equipmentNetBookValue,
  openAp2010Display,
  openTax2030Display,
  onNotice,
}) {
  const setNotice = onNotice;
  const setPnlData = onPnlRefreshed;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [actionModal, setActionModal] = useState(null); // null | 'opex' | 'settle' | 'depreciation' | 'income_tax' | 'drawing' | 'capital' | 'transfer'
  const [formAmount, setFormAmount] = useState("");
  const [formMemo, setFormMemo] = useState("");
  const [formExpenseCode, setFormExpenseCode] = useState("6120");
  const [formExpenseCategory, setFormExpenseCategory] = useState("");
  const [formPrimaryAccount, setFormPrimaryAccount] = useState("1010");
  const [formSecondaryAccount, setFormSecondaryAccount] = useState("1030");
  const [formPaymentStatus, setFormPaymentStatus] = useState("paid"); // 'paid' | 'unpaid'
  const [formVendorName, setFormVendorName] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formEntryDate, setFormEntryDate] = useState("");
  const [budgetPrompt, setBudgetPrompt] = useState(null); // { labels, resolve }
  const budgetGoBackRef = useRef(null);
  const [settleLiabilityCode, setSettleLiabilityCode] = useState("2010");
  const [selectedPayableId, setSelectedPayableId] = useState("");
  const [estimatorCost, setEstimatorCost] = useState("");
  const [estimatorMonths, setEstimatorMonths] = useState("36");
  const [estimatorOpen, setEstimatorOpen] = useState(false);
  const [nibtRefreshing, setNibtRefreshing] = useState(false);
  const [clientRequestId, setClientRequestId] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formErrorField, setFormErrorField] = useState(null);

  const actionModalRef = useRef(null);
  const incomeTaxFetchSeqRef = useRef(0);
  const paidRadioRef = useRef(null);
  const unpaidRadioRef = useRef(null);
  const amountInputRef = useRef(null);
  const memoInputRef = useRef(null);
  const secondaryAccountRef = useRef(null);

  useEffect(() => {
    actionModalRef.current = actionModal;
  }, [actionModal]);


  // "What was it for?" mirrors the Expenses and Payroll sidebar: same folders, same names.
  // Each option is a sidebar category plus the account it posts to. A category that owns several
  // manual accounts (e.g. Other Operating Supplies) lists each one, so ledger detail is kept.
  const navOpexGroups = useMemo(() => {
    const manual = new Map(coaAccounts.filter(isManualExpenseAccount).map((a) => [String(a.accountCode), a]));
    const bySlug = new Map(EXPENSE_NAV_CATEGORIES.map((c) => [c.slug, c]));
    const groups = EXPENSE_NAV_TREE.map((node) => {
      const parent = bySlug.get(node.slug);
      const leaves = node.children.length ? node.children.map((slug) => bySlug.get(slug)) : [parent];
      const rows = leaves
        .filter((leaf) => leaf && !leaf.readOnly)
        .flatMap((leaf) => {
          const codes = leaf.accountCodes.filter((code) => manual.has(code));
          return codes.map((code) => ({
            value: `${leaf.slug}|${code}`,
            slug: leaf.slug,
            code,
            label: codes.length === 1
              ? leaf.label
              : code === "6020" ? `${leaf.label} (older records)` : (SPLIT_ACCOUNT_LABELS[code] || manual.get(code).accountName),
          }));
        });
      return { group: parent?.label || node.slug, rows };
    }).filter((grp) => grp.rows.length);
    // Any manual account no sidebar category owns stays pickable rather than disappearing.
    const covered = new Set(groups.flatMap((grp) => grp.rows.map((r) => r.code)));
    const leftovers = [...manual.values()].filter((a) => !covered.has(String(a.accountCode)));
    if (leftovers.length) {
      groups.push({
        group: "Other",
        rows: leftovers.map((a) => ({ value: `|${a.accountCode}`, slug: "", code: String(a.accountCode), label: a.accountName })),
      });
    }
    return groups;
  }, [coaAccounts]);
  const navOpexRows = useMemo(() => navOpexGroups.flatMap((grp) => grp.rows), [navOpexGroups]);
  const selectedOpexValue =
    (navOpexRows.find((r) => r.slug === formExpenseCategory && r.code === String(formExpenseCode))
      || navOpexRows.find((r) => r.code === String(formExpenseCode)))?.value || "";

  const matchingOpenPayables = useMemo(
    () => openPayables.filter((p) => p.liabilityAccountCode === settleLiabilityCode),
    [openPayables, settleLiabilityCode],
  );

  const selectedPayable = useMemo(
    () => matchingOpenPayables.find((p) => String(p.id) === String(selectedPayableId)) || null,
    [matchingOpenPayables, selectedPayableId],
  );

  const trackedOpenTotalForSettle = useMemo(
    () => round2(matchingOpenPayables.reduce((s, p) => s + Number(p.remainingAmount || 0), 0)),
    [matchingOpenPayables],
  );

  const glBalanceForSettle = settleLiabilityCode === "2030"
    ? (payablesTotals.glTax2030Balance || 0)
    : (payablesTotals.glAp2010Balance || 0);

  const untrackedBalanceForSettle = round2(Math.max(0, glBalanceForSettle - trackedOpenTotalForSettle));
  const maxSettleableAmount = selectedPayable
    ? round2(selectedPayable.remainingAmount)
    : untrackedBalanceForSettle;


  const handlePaymentStatusKeyDown = (event) => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      const nextStatus = formPaymentStatus === "paid" ? "unpaid" : "paid";
      setFormPaymentStatus(nextStatus);
      window.requestAnimationFrame(() => {
        const target = nextStatus === "paid" ? paidRadioRef.current : unpaidRadioRef.current;
        target?.focus();
      });
    }
  };

  const focusInvalidField = (fieldKey) => {
    setFormErrorField(fieldKey);
    window.requestAnimationFrame(() => {
      if (fieldKey === "amount") amountInputRef.current?.focus();
      else if (fieldKey === "memo") memoInputRef.current?.focus();
      else if (fieldKey === "transfer") secondaryAccountRef.current?.focus();
    });
  };

  const openActionModal = (mode, opts = {}) => {
    setActionModal(mode);
    actionModalRef.current = mode;
    setFormAmount("");
    setFormError(null);
    setFormErrorField(null);
    setFormPaymentStatus("paid");
    setFormVendorName("");
    setFormDueDate("");
    setFormEntryDate("");
    setBudgetPrompt(null);
    setEstimatorOpen(false);
    setNibtRefreshing(false);
    setClientRequestId(createFinClientRequestId());

    const preferredOpex =
      coaAccounts.find((a) => isManualExpenseAccount(a) && a.accountCode === "6131") ||
      coaAccounts.find((a) => isManualExpenseAccount(a) && a.accountCode === "6120") ||
      coaAccounts.find((a) => isManualExpenseAccount(a) && a.accountCode !== "6020") ||
      coaAccounts.find(isManualExpenseAccount);
    setFormExpenseCode(preferredOpex?.accountCode || "6120");
    const preferredCode = String(preferredOpex?.accountCode || "6120");
    const preferredCategories = EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(preferredCode)).sort((a, b) => a.accountCodes.length - b.accountCodes.length);
    setFormExpenseCategory(preferredCategories[0]?.slug || "");
    setFormPrimaryAccount(mode === "settle" ? "1030" : "1010");
    setFormSecondaryAccount(mode === "transfer" ? "1030" : "1010");

    if (mode === "opex") {
      setFormMemo("Store expense");
    } else if (mode === "settle") {
      const liabCode = opts.liabilityCode === "2030" ? "2030" : "2010";
      setSettleLiabilityCode(liabCode);
      const firstOpen = openPayables.find((p) => p.liabilityAccountCode === liabCode);
      setSelectedPayableId(firstOpen ? String(firstOpen.id) : "");
      setFormMemo(
        firstOpen
          ? `Payment for ${firstOpen.billNumber}${firstOpen.vendorName ? ` (${firstOpen.vendorName})` : ""}`
          : (liabCode === "2030" ? "Income tax payment" : "Bill payment"),
      );
    } else if (mode === "depreciation") {
      // Spread what is left to depreciate (net book value), not the original cost.
      setEstimatorCost(equipmentNetBookValue > 0 ? String(equipmentNetBookValue) : "");
      setEstimatorMonths("36");
      setFormMemo("Monthly equipment wear & tear");
    } else if (mode === "income_tax") {
      setFormPrimaryAccount("1030");
      setFormMemo("Income tax");
      const reqSeq = ++incomeTaxFetchSeqRef.current;
      setNibtRefreshing(true);
      apiRequest(`/finances/reports/profit-and-loss${buildDateParams()}`, { headers: netIncomePin.financialHeaders })
        .then((res) => {
          if (!isMountedRef.current) return;
          if (incomeTaxFetchSeqRef.current !== reqSeq) return;
          if (actionModalRef.current !== "income_tax") return;
          setPnlData(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!isMountedRef.current) return;
          if (incomeTaxFetchSeqRef.current !== reqSeq) return;
          setNibtRefreshing(false);
        });
    } else if (mode === "drawing") {
      setFormMemo("Owner withdrawal");
    } else if (mode === "capital") {
      setFormMemo("Owner added money to the business");
    } else if (mode === "transfer") {
      setFormMemo("Moved money between accounts");
    }
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    if (formSubmitting) return;
    const amount = round2(Number(formAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Please enter a valid positive amount.");
      focusInvalidField("amount");
      return;
    }
    const cleanMemo = formMemo.trim();
    if (cleanMemo.length < 3) {
      setFormError("Please add a short note describing this.");
      focusInvalidField("memo");
      return;
    }

    const reqId = clientRequestId || createFinClientRequestId();
    if (!clientRequestId) setClientRequestId(reqId);

    try {
      setFormSubmitting(true);
      setFormError(null);
      setFormErrorField(null);

      if (actionModal === "settle") {
        if (amount > maxSettleableAmount + 0.001) {
          setFormError(`Payment cannot exceed ${peso(maxSettleableAmount)}.`);
          focusInvalidField("amount");
          return;
        }
        let settleResult = null;
        if (selectedPayable) {
          settleResult = await apiRequest(`/finances/payables/${selectedPayable.id}/settle`, {
            method: "POST",
            body: JSON.stringify({
              paymentAccountCode: formPrimaryAccount,
              amount,
              notes: cleanMemo,
              clientRequestId: reqId,
            }),
          });
        } else {
          settleResult = await apiRequest("/finances/journal-entries", {
            method: "POST",
            body: JSON.stringify({
              entryType: "ap_settlement",
              memo: cleanMemo,
              clientRequestId: reqId,
              lines: [
                { accountCode: settleLiabilityCode, debit: amount, credit: 0, lineMemo: cleanMemo },
                { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: cleanMemo },
              ],
            }),
          });
        }
        setActionModal(null);
        setNotice(withWarnings(`Paid ${peso(amount)} toward ${settleLiabilityCode === "2030" ? "income tax owed" : "unpaid bills"}: ${cleanMemo}`, settleResult));
        window.dispatchEvent(new Event("amaya:stock-mutated"));
        return;
      }

      let entryType = "adjustment";
      let budgetCheckFailed = false;
      let lines = [];
      const extraBody = { clientRequestId: reqId };

      if (actionModal === "opex") {
        // The budget that counts is the one for the month the expense is dated in.
        const expenseMonth = (formEntryDate || manilaToday()).slice(0, 7);
        try {
          const healthResponse = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(expenseMonth)}`);
          const affectedBudgets = (healthResponse?.items || []).filter((item) => item.category === formExpenseCategory && item.budget != null && amount > Number(item.remaining));
          if (affectedBudgets.length) {
            const labels = affectedBudgets.map((item) => `${item.label} (over by ${peso(amount - Number(item.remaining))})`).join(", ");
            const shouldContinue = await new Promise((resolve) => setBudgetPrompt({ labels, resolve }));
            setBudgetPrompt(null);
            if (!shouldContinue) return;
          }
        } catch {
          // The budget check is advice only. If it can't run, the expense still posts.
          budgetCheckFailed = true;
        }
        entryType = "operating_expense";
        const creditCode = formPaymentStatus === "unpaid" ? "2010" : formPrimaryAccount;
        lines = [
          { accountCode: formExpenseCode, debit: amount, credit: 0, lineMemo: cleanMemo },
          { accountCode: creditCode, debit: 0, credit: amount, lineMemo: cleanMemo },
        ];
        if (formPaymentStatus === "unpaid") {
          if (formVendorName.trim()) extraBody.vendorName = formVendorName.trim();
          if (formDueDate) extraBody.dueDate = formDueDate;
        }
      } else if (actionModal === "depreciation") {
        if (equipmentNetBookValue <= 0) {
          setFormError("There is no equipment value left to write down.");
          setFormErrorField("form");
          return;
        }
        if (amount > equipmentNetBookValue + 0.001) {
          setFormError(`Wear & tear cannot be more than the equipment value left (${peso(equipmentNetBookValue)}).`);
          focusInvalidField("amount");
          return;
        }
        entryType = "depreciation";
        lines = [
          { accountCode: "6210", debit: amount, credit: 0, lineMemo: cleanMemo },
          { accountCode: "1520", debit: 0, credit: amount, lineMemo: cleanMemo },
        ];
      } else if (actionModal === "income_tax") {
        entryType = "income_tax";
        const creditCode = formPaymentStatus === "unpaid" ? "2030" : formPrimaryAccount;
        lines = [
          { accountCode: "6310", debit: amount, credit: 0, lineMemo: cleanMemo },
          { accountCode: creditCode, debit: 0, credit: amount, lineMemo: cleanMemo },
        ];
        if (formPaymentStatus === "unpaid") {
          if (formVendorName.trim()) extraBody.vendorName = formVendorName.trim();
          if (formDueDate) extraBody.dueDate = formDueDate;
        }
      } else if (actionModal === "drawing") {
        entryType = "owner_withdrawal";
        lines = [
          { accountCode: "3020", debit: amount, credit: 0, lineMemo: cleanMemo },
          { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: cleanMemo },
        ];
      } else if (actionModal === "capital") {
        entryType = "capital_injection";
        lines = [
          { accountCode: formPrimaryAccount, debit: amount, credit: 0, lineMemo: cleanMemo },
          { accountCode: "3010", debit: 0, credit: amount, lineMemo: cleanMemo },
        ];
      } else if (actionModal === "transfer") {
        if (formPrimaryAccount === formSecondaryAccount) {
          setFormError("Pick two different accounts to move money between.");
          focusInvalidField("transfer");
          return;
        }
        entryType = "account_transfer";
        lines = [
          { accountCode: formSecondaryAccount, debit: amount, credit: 0, lineMemo: `Transfer from ${formPrimaryAccount}` },
          { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: `Transfer to ${formSecondaryAccount}` },
        ];
      }

      const postResult = await apiRequest("/finances/journal-entries", {
        method: "POST",
        body: JSON.stringify({ entryType, memo: cleanMemo, lines, ...(entryType === "operating_expense" && formExpenseCategory ? { expenseCategory: formExpenseCategory } : {}), ...(entryType === "operating_expense" && formEntryDate ? { entryDate: formEntryDate } : {}), ...extraBody }),
      });
      setActionModal(null);
      setNotice(withWarnings(`Saved ${peso(amount)}: ${cleanMemo}${budgetCheckFailed ? " (The budget check could not run, so check this month's budget yourself.)" : ""}`, postResult));
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "We could not save this. Please try again.");
      setFormErrorField("form");
    } finally {
      setFormSubmitting(false);
    }
  };


  useEffect(() => {
    if (budgetPrompt) budgetGoBackRef.current?.focus();
  }, [budgetPrompt]);

  const nibtValue = round2(pnlData?.netIncomeBeforeTax ?? (Number(pnlData?.ebitdaOperatingIncome ?? 0) - Number(pnlData?.depreciation ?? 0)));
  const parsedEstCost = Number(estimatorCost);
  const parsedEstMonths = Number(estimatorMonths);
  const suggestedMonthlyDepr = Number.isFinite(parsedEstCost) && parsedEstCost > 0 && Number.isFinite(parsedEstMonths) && parsedEstMonths > 0
    ? round2(Math.min(parsedEstCost, equipmentNetBookValue) / parsedEstMonths)
    : 0;

  useImperativeHandle(ref, () => ({ open: openActionModal }));

  return (
      <FinDialog
        isOpen={Boolean(actionModal)}
        onClose={() => setActionModal(null)}
        busy={formSubmitting}
        titleId="fin-action-modal-title"
        maxWidth={actionModal === "depreciation" || actionModal === "income_tax" ? "520px" : "480px"}
        title={
          actionModal === "opex"
            ? "Record an Expense"
            : actionModal === "settle"
              ? (settleLiabilityCode === "2030" ? "Pay Income Tax You Owe" : "Pay Unpaid Bills")
              : actionModal === "depreciation"
                ? "Record Equipment Wear & Tear"
                : actionModal === "income_tax"
                  ? "Record Income Tax"
                  : actionModal === "drawing"
                    ? "Record Owner Withdrawal"
                    : actionModal === "capital"
                      ? "Add Owner's Money"
                      : "Move Money Between Accounts"
        }
      >
        <form onSubmit={handleActionSubmit} className="fin-modal-body" style={{ padding: "1.25rem 1.4rem" }}>
          {formError && (
            <div id="fin-modal-form-error" className="fin-form-error" role="alert">
              {formError}
            </div>
          )}

          {/* 1. RECORD AN OPERATING EXPENSE */}
          {actionModal === "opex" && (
            <>
              <div className="fin-form-group">
                <label htmlFor="fin-opex-account">What was it for? *</label>
                <select
                  id="fin-opex-account"
                  className="fin-form-input"
                  value={navOpexRows.length > 0 ? selectedOpexValue : formExpenseCode}
                  onChange={(e) => {
                    const [slug, code] = e.target.value.includes("|") ? e.target.value.split("|") : ["", e.target.value];
                    // slug is "" for the "Other" group: fall back to the closest category for the account.
                    setFormExpenseCode(code);
                    if (slug) {
                      setFormExpenseCategory(slug);
                    } else {
                      const nextCategories = EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(code)).sort((a, b) => a.accountCodes.length - b.accountCodes.length);
                      setFormExpenseCategory(nextCategories[0]?.slug || "");
                    }
                  }}
                >
                  {navOpexRows.length > 0 ? (
                    navOpexGroups.map((grp) => (
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.rows.map((row) => (
                          <option key={row.value} value={row.value}>
                            {withCode(row.code, row.label)}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  ) : (
                    <>
                      <option value="6120">Rent and occupancy</option>
                      <option value="6131">Electricity</option>
                      <option value="6140">Operating supplies</option>
                      <option value="6144">Sanitation supplies</option>
                      <option value="6172">Taxes and licenses (permits)</option>
                      <option value="6010">Other running costs</option>
                    </>
                  )}
                </select>
              </div>

              <div className="fin-form-group">
                <label htmlFor="fin-opex-budget-category">Counts Toward Budget</label>
                <select
                  id="fin-opex-budget-category"
                  className="fin-form-input"
                  value={formExpenseCategory}
                  onChange={(e) => setFormExpenseCategory(e.target.value)}
                >
                  <option value="">Not part of a budget</option>
                  {EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(String(formExpenseCode))).map((category) => (
                    <option key={category.slug} value={category.slug}>{category.label}</option>
                  ))}
                </select>
                <small>Pick the closest budget so this expense counts toward its monthly limit.</small>
              </div>

              <div className="fin-form-group">
                <label htmlFor="fin-opex-date">Date of Expense (Optional)</label>
                <input
                  id="fin-opex-date"
                  type="date"
                  className="fin-form-input"
                  max={manilaToday()}
                  value={formEntryDate}
                  onChange={(e) => setFormEntryDate(e.target.value)}
                />
                <small>Leave blank for today. Pick an earlier day if this is a receipt entered late, so it counts toward the right month&apos;s budget and reports.</small>
              </div>

              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4a2c11", marginBottom: "0.35rem" }}>
                  Payment Status *
                </legend>
                <div className="fin-radio-grid" role="radiogroup" aria-label="Operating expense payment status">
                  <button
                    ref={paidRadioRef}
                    type="button"
                    role="radio"
                    aria-checked={formPaymentStatus === "paid"}
                    tabIndex={formPaymentStatus === "paid" ? 0 : -1}
                    className={`fin-radio-card ${formPaymentStatus === "paid" ? "is-selected" : ""}`}
                    onClick={() => setFormPaymentStatus("paid")}
                    onKeyDown={handlePaymentStatusKeyDown}
                  >
                    <strong><span aria-hidden="true">{formPaymentStatus === "paid" ? "●" : "○"}</span> Paid Immediately</strong>
                    <small>Money leaves cash, GCash or the bank now</small>
                  </button>
                  <button
                    ref={unpaidRadioRef}
                    type="button"
                    role="radio"
                    aria-checked={formPaymentStatus === "unpaid"}
                    tabIndex={formPaymentStatus === "unpaid" ? 0 : -1}
                    className={`fin-radio-card ${formPaymentStatus === "unpaid" ? "is-selected" : ""}`}
                    onClick={() => setFormPaymentStatus("unpaid")}
                    onKeyDown={handlePaymentStatusKeyDown}
                  >
                    <strong><span aria-hidden="true">{formPaymentStatus === "unpaid" ? "●" : "○"}</span> Unpaid Bill / Pay Later</strong>
                    <small>Saved as an unpaid bill to pay later</small>
                  </button>
                </div>
              </fieldset>

              {formPaymentStatus === "paid" ? (
                <div className="fin-form-group">
                  <label htmlFor="fin-opex-liquid">Paid From *</label>
                  <select
                    id="fin-opex-liquid"
                    className="fin-form-input"
                    value={formPrimaryAccount}
                    onChange={(e) => setFormPrimaryAccount(e.target.value)}
                  >
                    {liquidAccountOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="fin-callout">
                    The expense counts in your profit report now and is saved as an <strong>unpaid bill</strong>. Your cash drawer is NOT reduced until you pay it.
                  </div>
                  <div className="fin-two-col">
                    <div className="fin-form-group">
                      <label htmlFor="fin-opex-vendor">Who to Pay (Optional)</label>
                      <input
                        id="fin-opex-vendor"
                        type="text"
                        className="fin-form-input"
                        maxLength={120}
                        value={formVendorName}
                        onChange={(e) => setFormVendorName(e.target.value)}
                        placeholder="e.g. Meralco, Supplier"
                      />
                    </div>
                    <div className="fin-form-group">
                      <label htmlFor="fin-opex-due">Due Date (Optional)</label>
                      <input
                        id="fin-opex-due"
                        type="date"
                        className="fin-form-input"
                        value={formDueDate}
                        onChange={(e) => setFormDueDate(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* 2. SETTLE UNPAID BILL / TAX */}
          {actionModal === "settle" && (
            <>
              <div className="fin-callout">
                <div>
                  Total still owed on {settleLiabilityCode === "2030" ? "income tax" : "unpaid bills"}:{" "}
                  <strong>{peso(settleLiabilityCode === "2030" ? openTax2030Display : openAp2010Display)}</strong>
                </div>
                <small style={{ color: "#6b5847" }}>
                  Paying this lowers your cash and clears the bill. It is not counted as a new expense, so your profit stays the same.
                </small>
              </div>

              {matchingOpenPayables.length > 0 && (
                <div className="fin-form-group">
                  <label htmlFor="fin-settle-bill-select">Which Bill? *</label>
                  <select
                    id="fin-settle-bill-select"
                    className="fin-form-input"
                    value={selectedPayableId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedPayableId(nextId);
                      const picked = matchingOpenPayables.find((p) => String(p.id) === nextId);
                      if (picked) {
                        setFormMemo(`Payment for ${picked.billNumber}${picked.vendorName ? ` (${picked.vendorName})` : ""}`);
                      }
                    }}
                  >
                    {matchingOpenPayables.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.billNumber} {p.vendorName ? `· ${p.vendorName}` : ""} · Remaining {peso(p.remainingAmount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="fin-form-group">
                <label htmlFor="fin-settle-liquid">Pay From *</label>
                <select
                  id="fin-settle-liquid"
                  className="fin-form-input"
                  value={formPrimaryAccount}
                  onChange={(e) => setFormPrimaryAccount(e.target.value)}
                >
                  {liquidAccountOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* 3. RECORD DEPRECIATION */}
          {actionModal === "depreciation" && (
            <>
              <div className="fin-callout">
                <div>
                  <strong>No cash leaves:</strong> this spreads the cost of your equipment over time as a yearly-style expense. It does not reduce cash, GCash or the bank.
                </div>
                <div style={{ marginTop: "0.25rem", color: "#4a2c11" }}>
                  Equipment bought: <strong>{peso(grossEquip1510)}</strong> &middot; Value left after wear &amp; tear:{" "}
                  <strong>{peso(equipmentNetBookValue)}</strong>
                </div>
              </div>

              {equipmentNetBookValue <= 0 && (
                <div className="fin-form-error" role="status">
                  There is no equipment value left to write down.
                </div>
              )}

              <details
                className="fin-estimator-details"
                open={estimatorOpen}
                onToggle={(e) => setEstimatorOpen(e.currentTarget.open)}
              >
                <summary>
                  {estimatorOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  Monthly Estimate (Optional)
                </summary>
                <div className="fin-two-col" style={{ marginTop: "0.6rem" }}>
                  <div className="fin-form-group">
                    <label htmlFor="fin-depr-cost">Value to Spread Out (₱)</label>
                    <input
                      id="fin-depr-cost"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className="fin-form-input fin-input-tabular"
                      value={estimatorCost}
                      onChange={(e) => setEstimatorCost(e.target.value)}
                      placeholder="60000.00"
                    />
                  </div>
                  <div className="fin-form-group">
                    <label htmlFor="fin-depr-months">How Many Months It Will Last</label>
                    <input
                      id="fin-depr-months"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      className="fin-form-input fin-input-tabular"
                      value={estimatorMonths}
                      onChange={(e) => setEstimatorMonths(e.target.value)}
                    />
                  </div>
                </div>
                <div className="fin-preset-row" style={{ marginTop: "0.55rem" }}>
                  {["12", "24", "36", "60"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={estimatorMonths === m}
                      className={`fin-preset-chip ${estimatorMonths === m ? "is-active" : ""}`}
                      onClick={() => setEstimatorMonths(m)}
                    >
                      {m}m
                    </button>
                  ))}
                  {suggestedMonthlyDepr > 0 && (
                    <button
                      type="button"
                      className="fin-preset-chip"
                      style={{ marginLeft: "auto", background: "#603b26", color: "#ffffff", borderColor: "#603b26" }}
                      onClick={() => setFormAmount(suggestedMonthlyDepr.toFixed(2))}
                    >
                      Use {peso(suggestedMonthlyDepr)} Amount
                    </button>
                  )}
                </div>
              </details>
            </>
          )}

          {/* 4. RECORD INCOME TAX */}
          {actionModal === "income_tax" && (
            <>
              <div className="fin-callout">
                <div>
                  Profit before tax this period: <strong>{netIncomePin.unlocked && pnlData?.netIncomeBeforeTax != null ? peso(nibtValue) : "₱••••••"}</strong>
                  {nibtRefreshing && <small style={{ marginLeft: "0.45rem", color: "#6b5847" }}>(Refreshing…)</small>}
                </div>
                <small style={{ color: "#6b5847" }}>
                  Income tax on your profit is separate from the VAT you collect on customer orders.
                </small>
              </div>

              <div className="fin-form-group">
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4a2c11" }}>
                  Quick Tax Estimate (% of profit before tax)
                </span>
                <div className="fin-preset-row">
                  {[8, 15, 20, 25].map((pct) => {
                    const est = nibtValue > 0 ? round2((nibtValue * pct) / 100) : 0;
                    return (
                      <button
                        key={pct}
                        type="button"
                        className="fin-preset-chip"
                        disabled={!netIncomePin.unlocked || nibtValue <= 0}
                        onClick={() => {
                          setFormAmount(est.toFixed(2));
                          setFormMemo(`Income tax estimate (${pct}% of ${peso(nibtValue)} profit)`);
                        }}
                      >
                        {pct}%{nibtValue > 0 ? ` (${peso(est)})` : ""}
                      </button>
                    );
                  })}
                </div>
                {!netIncomePin.unlocked ? (
                  <small style={{ fontSize: "0.75rem", color: "#6b5847" }}>
                    Profit is hidden. Enter the Net Income PIN on the Profit tab to see it and use these estimates, or type the tax amount yourself.
                  </small>
                ) : nibtValue <= 0 && (
                  <small style={{ fontSize: "0.75rem", color: "#6b5847" }}>
                    No positive taxable profit in selected period &mdash; enter manual tax only if applicable.
                  </small>
                )}
              </div>

              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4a2c11", marginBottom: "0.35rem" }}>
                  Payment Status *
                </legend>
                <div className="fin-radio-grid" role="radiogroup" aria-label="Income tax payment status">
                  <button
                    ref={paidRadioRef}
                    type="button"
                    role="radio"
                    aria-checked={formPaymentStatus === "paid"}
                    tabIndex={formPaymentStatus === "paid" ? 0 : -1}
                    className={`fin-radio-card ${formPaymentStatus === "paid" ? "is-selected" : ""}`}
                    onClick={() => setFormPaymentStatus("paid")}
                    onKeyDown={handlePaymentStatusKeyDown}
                  >
                    <strong><span aria-hidden="true">{formPaymentStatus === "paid" ? "●" : "○"}</span> Paid Immediately</strong>
                    <small>Money leaves cash, bank or e-wallet now</small>
                  </button>
                  <button
                    ref={unpaidRadioRef}
                    type="button"
                    role="radio"
                    aria-checked={formPaymentStatus === "unpaid"}
                    tabIndex={formPaymentStatus === "unpaid" ? 0 : -1}
                    className={`fin-radio-card ${formPaymentStatus === "unpaid" ? "is-selected" : ""}`}
                    onClick={() => setFormPaymentStatus("unpaid")}
                    onKeyDown={handlePaymentStatusKeyDown}
                  >
                    <strong><span aria-hidden="true">{formPaymentStatus === "unpaid" ? "●" : "○"}</span> Not Paid Yet</strong>
                    <small>Saved as tax still owed</small>
                  </button>
                </div>
              </fieldset>

              {formPaymentStatus === "paid" ? (
                <div className="fin-form-group">
                  <label htmlFor="fin-tax-liquid">Paid From *</label>
                  <select
                    id="fin-tax-liquid"
                    className="fin-form-input"
                    value={formPrimaryAccount}
                    onChange={(e) => setFormPrimaryAccount(e.target.value)}
                  >
                    {liquidAccountOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="fin-two-col">
                  <div className="fin-form-group">
                    <label htmlFor="fin-tax-vendor">Who to Pay / Period (Optional)</label>
                    <input
                      id="fin-tax-vendor"
                      type="text"
                      className="fin-form-input"
                      maxLength={120}
                      value={formVendorName}
                      onChange={(e) => setFormVendorName(e.target.value)}
                      placeholder="BIR Income Tax"
                    />
                  </div>
                  <div className="fin-form-group">
                    <label htmlFor="fin-tax-due">Due Date (Optional)</label>
                    <input
                      id="fin-tax-due"
                      type="date"
                      className="fin-form-input"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* 5. DRAWING / CAPITAL / TRANSFER */}
          {(actionModal === "drawing" || actionModal === "capital" || actionModal === "transfer") && (
            <>
              <div className="fin-form-group">
                <label htmlFor="fin-primary-liquid">
                  {actionModal === "capital"
                    ? "Put Into *"
                    : actionModal === "transfer"
                      ? "Take Money From *"
                      : "Take Money From *"}
                </label>
                <select
                  id="fin-primary-liquid"
                  className="fin-form-input"
                  value={formPrimaryAccount}
                  onChange={(e) => {
                    setFormPrimaryAccount(e.target.value);
                    if (formErrorField === "transfer") {
                      setFormError(null);
                      setFormErrorField(null);
                    }
                  }}
                >
                  {liquidAccountOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {actionModal === "transfer" && (
                <div className="fin-form-group">
                  <label htmlFor="fin-secondary-liquid">Move It Into *</label>
                  <select
                    ref={secondaryAccountRef}
                    id="fin-secondary-liquid"
                    aria-invalid={formErrorField === "transfer"}
                    aria-describedby={formErrorField === "transfer" ? "fin-modal-form-error" : undefined}
                    className="fin-form-input"
                    value={formSecondaryAccount}
                    onChange={(e) => {
                      setFormSecondaryAccount(e.target.value);
                      if (formErrorField === "transfer") {
                        setFormError(null);
                        setFormErrorField(null);
                      }
                    }}
                  >
                    {liquidAccountOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* SHARED AMOUNT + MEMO FIELDS */}
          <div className="fin-form-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <label htmlFor="fin-action-amount">Amount (₱) *</label>
              {actionModal === "settle" && maxSettleableAmount > 0 && (
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => setFormAmount(maxSettleableAmount.toFixed(2))}
                >
                  Fill Full: {peso(maxSettleableAmount)}
                </button>
              )}
            </div>
            <input
              ref={amountInputRef}
              id="fin-action-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              spellCheck={false}
              aria-invalid={formErrorField === "amount"}
              aria-describedby={formErrorField === "amount" ? "fin-modal-form-error" : undefined}
              className="fin-form-input fin-input-tabular"
              value={formAmount}
              onChange={(e) => {
                setFormAmount(e.target.value);
                if (formErrorField === "amount") {
                  setFormError(null);
                  setFormErrorField(null);
                }
              }}
              placeholder="0.00"
            />
          </div>

          <div className="fin-form-group">
            <label htmlFor="fin-action-memo">Note *</label>
            <input
              ref={memoInputRef}
              id="fin-action-memo"
              type="text"
              required
              maxLength={255}
              aria-invalid={formErrorField === "memo"}
              aria-describedby={formErrorField === "memo" ? "fin-modal-form-error" : undefined}
              className="fin-form-input"
              value={formMemo}
              onChange={(e) => {
                setFormMemo(e.target.value);
                if (formErrorField === "memo") {
                  setFormError(null);
                  setFormErrorField(null);
                }
              }}
            />
          </div>

          {budgetPrompt && (
            <div className="fin-callout" role="alertdialog" aria-label="Budget warning">
              <div>This expense goes over the monthly budget for: <strong>{budgetPrompt.labels}</strong>.</div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                <button ref={budgetGoBackRef} type="button" className="fin-modal-btn-secondary" onClick={() => budgetPrompt.resolve(false)}>
                  Go Back
                </button>
                <button type="button" className="fin-modal-btn-primary" onClick={() => budgetPrompt.resolve(true)}>
                  Post Anyway
                </button>
              </div>
            </div>
          )}

          <div className="fin-modal-footer" style={{ margin: "0.35rem -1.4rem -1.25rem", padding: "0.95rem 1.4rem" }}>
            <button
              type="button"
              className="fin-modal-btn-secondary"
              disabled={formSubmitting}
              onClick={() => setActionModal(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fin-modal-btn-primary"
              disabled={formSubmitting}
              aria-busy={formSubmitting}
            >
              {formSubmitting
                ? "Saving…"
                : actionModal === "settle"
                  ? "Confirm Payment"
                  : actionModal === "depreciation"
                    ? "Save Wear & Tear"
                    : actionModal === "income_tax"
                      ? "Save Income Tax"
                      : "Save"}
            </button>
          </div>
        </form>
      </FinDialog>
  );
}
