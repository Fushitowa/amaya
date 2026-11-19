import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Calendar,
  Scale,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  ArrowLeftRight,
  PlusCircle,
  Wallet,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { EXPENSE_NAV_CATEGORIES } from "../config/expenseNavigation.js";
import { BalanceSheetTabView, CashFlowTabView, JournalAuditTabView } from "./admin/finances/FinancialStatementTabs.jsx";
import "../assets/css/admin/FinancialManagement.css";

function peso(val) {
  const num = Number(val || 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `₱${safe.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function round2(val) {
  const num = Number(val || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

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

const LIQUID_ACCOUNT_OPTIONS = [
  { code: "1010", label: "1010 - Cash Drawer (Counter 1)" },
  { code: "1020", label: "1020 - GCash Official Wallet" },
  { code: "1030", label: "1030 - Store Bank Account" },
  { code: "1040", label: "1040 - Owner Capital Reserve" },
];

const OPEX_GROUP_ORDER = [
  "Labor & Payroll",
  "Rent & Occupancy",
  "Utilities",
  "Operating Supplies",
  "Advertising & Marketing",
  "Repairs & Maintenance",
  "General & Administrative (G&A)",
  "Others",
  "Utilities & Rent (Legacy)",
];

const PNL_DISPLAY_GROUPS = [
  { key: "Labor & Payroll", label: "1. Labor & Payroll" },
  { key: "Rent & Occupancy", label: "2. Rent & Occupancy" },
  { key: "Utilities", label: "3. Utilities" },
  { key: "Operating Supplies", label: "4. Operating Supplies" },
  { key: "Advertising & Marketing", label: "5. Advertising & Marketing" },
  { key: "Repairs & Maintenance", label: "6. Repairs & Maintenance" },
  { key: "General & Administrative (G&A)", label: "7. General & Administrative (G&A)" },
  { key: "Others & Legacy", label: "8. Others & Legacy" },
];

function groupOpexByExpenseGroup(items = []) {
  const buckets = new Map();
  for (const item of items) {
    const grp = item.expenseGroup || "Others";
    if (!buckets.has(grp)) buckets.set(grp, []);
    buckets.get(grp).push(item);
  }
  const rank = (name) => {
    const idx = OPEX_GROUP_ORDER.indexOf(name);
    return idx === -1 ? OPEX_GROUP_ORDER.length : idx;
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    })
    .map(([group, rows]) => ({
      group,
      rows: [...rows].sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode))),
    }));
}

function buildPnlOpexWaterfallGroups(items = []) {
  const byDisplayKey = new Map(PNL_DISPLAY_GROUPS.map((g) => [g.key, []]));
  for (const item of items) {
    const rawGroup = item.expenseGroup || "Others";
    const key = (rawGroup === "Others" || rawGroup === "Utilities & Rent (Legacy)")
      ? "Others & Legacy"
      : (byDisplayKey.has(rawGroup) ? rawGroup : "Others & Legacy");
    byDisplayKey.get(key).push(item);
  }
  return PNL_DISPLAY_GROUPS.map((g) => {
    const rows = [...(byDisplayKey.get(g.key) || [])].sort((a, b) =>
      String(a.accountCode).localeCompare(String(b.accountCode)),
    );
    const subtotal = round2(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
    return {
      key: g.key,
      label: g.label,
      rows,
      subtotal,
    };
  });
}

function FinDialog({ isOpen, onClose, title, titleId, busy = false, maxWidth = "480px", children }) {
  const boxRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frameId = window.requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      const firstFocusable = box.querySelector(
        'select:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button:not([disabled])',
      );
      if (firstFocusable instanceof HTMLElement) {
        firstFocusable.focus();
      } else {
        box.focus();
      }
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key === "Tab" && boxRef.current) {
        const focusables = Array.from(
          boxRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      const prevEl = previousFocusRef.current;
      if (prevEl && prevEl.isConnected && typeof prevEl.focus === "function") {
        prevEl.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fin-modal-overlay"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="fin-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fin-modal-header">
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className="fin-modal-close-btn"
            disabled={busy}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function FinancialReconciliationCenter() {
  const [activeTab, setActiveTab] = useState("recon"); // 'recon', 'pnl', 'cashflow', 'balancesheet', 'journal'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filters & Pagination
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reconPage, setReconPage] = useState(1);
  const [reconTotal, setReconTotal] = useState(0);
  const [journalPage, setJournalPage] = useState(1);
  const [journalTotal, setJournalTotal] = useState(0);

  // Data states
  const [coaAccounts, setCoaAccounts] = useState([]);
  const [openPayables, setOpenPayables] = useState([]);
  const [payablesTotals, setPayablesTotals] = useState({
    unpaidAp2010: 0,
    unpaidTax2030: 0,
    glAp2010Balance: 0,
    glTax2030Balance: 0,
  });
  const [reconData, setReconData] = useState([]);
  const [pnlData, setPnlData] = useState(null);
  const [cfData, setCfData] = useState(null);
  const [bsData, setBsData] = useState(null);
  const [journalData, setJournalData] = useState([]);

  // P&L OPEX collapse/zero-group controls
  const [expandedOpexGroups, setExpandedOpexGroups] = useState({});
  const [showZeroOpexGroups, setShowZeroOpexGroups] = useState(true);

  // Reversal & Action Modals
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState("");
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

  const isMountedRef = useRef(true);
  const actionModalRef = useRef(null);
  const incomeTaxFetchSeqRef = useRef(0);
  const paidRadioRef = useRef(null);
  const unpaidRadioRef = useRef(null);
  const amountInputRef = useRef(null);
  const memoInputRef = useRef(null);
  const secondaryAccountRef = useRef(null);
  const reverseReasonRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    actionModalRef.current = actionModal;
  }, [actionModal]);

  const buildDateParams = useCallback((extra = {}) => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [fromDate, toDate]);

  const loadMeta = useCallback(async () => {
    try {
      const [accRes, payRes] = await Promise.all([
        apiRequest("/finances/accounts"),
        apiRequest("/finances/payables?status=open"),
      ]);
      if (Array.isArray(accRes?.accounts)) {
        setCoaAccounts(accRes.accounts);
      }
      if (Array.isArray(payRes?.items)) {
        setOpenPayables(payRes.items);
      }
      if (payRes?.totals) {
        setPayablesTotals(payRes.totals);
      }
    } catch {
      // ignore background refresh error; main tab loader surfaces connection errors
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest("/finances/accounts"),
      apiRequest("/finances/payables?status=open"),
    ])
      .then(([accRes, payRes]) => {
        if (!active) return;
        if (Array.isArray(accRes?.accounts)) {
          setCoaAccounts(accRes.accounts);
        }
        if (Array.isArray(payRes?.items)) {
          setOpenPayables(payRes.items);
        }
        if (payRes?.totals) {
          setPayablesTotals(payRes.totals);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadTab = async () => {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === "recon") {
          const res = await apiRequest(`/finances/reports/daily-reconciliation${buildDateParams({ page: reconPage, limit: 25 })}`);
          if (!active) return;
          setReconData(res.items || []);
          setReconTotal(Number(res.total || 0));
        } else if (activeTab === "pnl") {
          const res = await apiRequest(`/finances/reports/profit-and-loss${buildDateParams()}`);
          if (!active) return;
          setPnlData(res);
        } else if (activeTab === "cashflow") {
          const res = await apiRequest(`/finances/reports/cash-flow${buildDateParams()}`);
          if (!active) return;
          setCfData(res);
        } else if (activeTab === "balancesheet") {
          const res = await apiRequest("/finances/reports/balance-sheet");
          if (!active) return;
          setBsData(res);
        } else if (activeTab === "journal") {
          const res = await apiRequest(`/finances/journal-entries${buildDateParams({ page: journalPage, limit: 25 })}`);
          if (!active) return;
          setJournalData(res.items || []);
          setJournalTotal(Number(res.total || 0));
        }
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load financial records.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadTab();
    const onExternalUpdate = () => {
      loadTab();
      loadMeta();
    };
    window.addEventListener("amaya:stock-mutated", onExternalUpdate);
    window.addEventListener("amaya:session-changed", onExternalUpdate);
    return () => {
      active = false;
      window.removeEventListener("amaya:stock-mutated", onExternalUpdate);
      window.removeEventListener("amaya:session-changed", onExternalUpdate);
    };
  }, [activeTab, buildDateParams, journalPage, reconPage, loadMeta]);

  const accountBalanceMap = useMemo(() => {
    const map = new Map();
    for (const acc of coaAccounts) {
      map.set(acc.accountCode, round2(acc.balance));
    }
    return map;
  }, [coaAccounts]);

  const groupedOpexAccounts = useMemo(
    () => groupOpexByExpenseGroup(coaAccounts.filter((a) => a.reportSection === "opex")),
    [coaAccounts],
  );

  const pnlOpexWaterfall = useMemo(
    () => buildPnlOpexWaterfallGroups(pnlData?.operatingExpenses || []),
    [pnlData?.operatingExpenses],
  );

  const grossEquip1510 = accountBalanceMap.get("1510") || 0;
  const accumDepr1520 = accountBalanceMap.get("1520") || 0;
  const equipmentNetBookValue = round2(Math.max(0, grossEquip1510 - accumDepr1520));

  const openAp2010Display = round2(Math.max(payablesTotals.unpaidAp2010 || 0, payablesTotals.glAp2010Balance || 0));
  const openTax2030Display = round2(Math.max(payablesTotals.unpaidTax2030 || 0, payablesTotals.glTax2030Balance || 0));

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
      else if (fieldKey === "reverseReason") reverseReasonRef.current?.focus();
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
    setEstimatorOpen(false);
    setNibtRefreshing(false);
    setClientRequestId(createFinClientRequestId());

    const preferredOpex =
      coaAccounts.find((a) => a.reportSection === "opex" && a.accountCode === "6131") ||
      coaAccounts.find((a) => a.reportSection === "opex" && a.accountCode === "6120") ||
      coaAccounts.find((a) => a.reportSection === "opex" && a.accountCode !== "6020") ||
      coaAccounts.find((a) => a.reportSection === "opex");
    setFormExpenseCode(preferredOpex?.accountCode || "6120");
    const preferredCode = String(preferredOpex?.accountCode || "6120");
    const preferredCategories = EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(preferredCode)).sort((a, b) => a.accountCodes.length - b.accountCodes.length);
    setFormExpenseCategory(preferredCategories[0]?.slug || "");
    setFormPrimaryAccount(mode === "settle" ? "1030" : "1010");
    setFormSecondaryAccount(mode === "transfer" ? "1030" : "1010");

    if (mode === "opex") {
      setFormMemo("Store Operating Expense");
    } else if (mode === "settle") {
      const liabCode = opts.liabilityCode === "2030" ? "2030" : "2010";
      setSettleLiabilityCode(liabCode);
      const firstOpen = openPayables.find((p) => p.liabilityAccountCode === liabCode);
      setSelectedPayableId(firstOpen ? String(firstOpen.id) : "");
      setFormMemo(
        firstOpen
          ? `Payment for ${firstOpen.billNumber}${firstOpen.vendorName ? ` (${firstOpen.vendorName})` : ""}`
          : (liabCode === "2030" ? "Business Income Tax Payment" : "Supplier / OPEX Bill Settlement"),
      );
    } else if (mode === "depreciation") {
      setEstimatorCost(grossEquip1510 > 0 ? String(grossEquip1510) : "");
      setEstimatorMonths("36");
      setFormMemo("Monthly Store & Equipment Depreciation");
    } else if (mode === "income_tax") {
      setFormPrimaryAccount("1030");
      setFormMemo("Business Income Tax");
      const reqSeq = ++incomeTaxFetchSeqRef.current;
      setNibtRefreshing(true);
      apiRequest(`/finances/reports/profit-and-loss${buildDateParams()}`)
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
      setFormMemo("Owner Drawing / Withdrawal");
    } else if (mode === "capital") {
      setFormMemo("Owner Capital Injection");
    } else if (mode === "transfer") {
      setFormMemo("Internal Treasury Fund Transfer");
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
      setFormError("Please provide a short memo describing this transaction.");
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
        if (selectedPayable) {
          await apiRequest(`/finances/payables/${selectedPayable.id}/settle`, {
            method: "POST",
            body: JSON.stringify({
              paymentAccountCode: formPrimaryAccount,
              amount,
              notes: cleanMemo,
              clientRequestId: reqId,
            }),
          });
        } else {
          await apiRequest("/finances/journal-entries", {
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
        setNotice(`Settled ${peso(amount)} on ${settleLiabilityCode === "2030" ? "Income Tax Payable" : "Accounts Payable"}: ${cleanMemo}`);
        window.dispatchEvent(new Event("amaya:stock-mutated"));
        return;
      }

      let entryType = "adjustment";
      let lines = [];
      const extraBody = { clientRequestId: reqId };

      if (actionModal === "opex") {
        const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date());
        const healthResponse = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(currentMonth)}`);
        const affectedBudgets = (healthResponse?.items || []).filter((item) => item.category === formExpenseCategory && item.budget != null && amount > Number(item.remaining));
        if (affectedBudgets.length) {
          const labels = affectedBudgets.map((item) => `${item.label} (over by ${peso(amount - Number(item.remaining))})`).join(", ");
          const shouldContinue = window.confirm(`This expense will exceed the monthly budget for: ${labels}. Continue and post it?`);
          if (!shouldContinue) return;
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
          setFormError("No remaining Equipment Net Book Value (1510 - 1520) available to depreciate.");
          setFormErrorField("form");
          return;
        }
        if (amount > equipmentNetBookValue + 0.001) {
          setFormError(`Depreciation cannot exceed remaining Equipment Net Book Value (${peso(equipmentNetBookValue)}).`);
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
          setFormError("Source and destination accounts must be different.");
          focusInvalidField("transfer");
          return;
        }
        entryType = "account_transfer";
        lines = [
          { accountCode: formSecondaryAccount, debit: amount, credit: 0, lineMemo: `Transfer from ${formPrimaryAccount}` },
          { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: `Transfer to ${formSecondaryAccount}` },
        ];
      }

      await apiRequest("/finances/journal-entries", {
        method: "POST",
        body: JSON.stringify({ entryType, memo: cleanMemo, lines, ...(entryType === "operating_expense" && formExpenseCategory ? { expenseCategory: formExpenseCategory } : {}), ...extraBody }),
      });
      setActionModal(null);
      setNotice(`Posted ${peso(amount)} journal entry: ${cleanMemo}`);
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "Failed to post financial transaction.");
      setFormErrorField("form");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleConfirmReverse = async (e) => {
    e.preventDefault();
    if (formSubmitting) return;
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (reason.length < 3) {
      setFormError("Please enter an audit reason (at least 3 characters).");
      focusInvalidField("reverseReason");
      return;
    }

    try {
      setFormSubmitting(true);
      setFormError(null);
      setFormErrorField(null);
      await apiRequest(`/finances/journal-entries/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReverseTarget(null);
      setReverseReason("");
      setNotice(`Traceable reversal posted for ${reverseTarget.entryNumber}.`);
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "Reversal failed.");
      setFormErrorField("form");
    } finally {
      setFormSubmitting(false);
    }
  };

  const dateInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const reconMaxPage = Math.max(1, Math.ceil(reconTotal / 25));
  const journalMaxPage = Math.max(1, Math.ceil(journalTotal / 25));

  const nibtValue = round2(pnlData?.netIncomeBeforeTax ?? (Number(pnlData?.ebitdaOperatingIncome ?? 0) - Number(pnlData?.depreciation ?? 0)));
  const netIncomeValue = round2(pnlData?.netIncome ?? pnlData?.netOperatingProfit ?? 0);
  const netMarginPercent = Number(pnlData?.netSales || 0) > 0
    ? round2((netIncomeValue / Number(pnlData.netSales)) * 100)
    : 0;

  const parsedEstCost = Number(estimatorCost);
  const parsedEstMonths = Number(estimatorMonths);
  const suggestedMonthlyDepr = Number.isFinite(parsedEstCost) && parsedEstCost > 0 && Number.isFinite(parsedEstMonths) && parsedEstMonths > 0
    ? round2(parsedEstCost / parsedEstMonths)
    : 0;

  const isGroupExpanded = (grp) => expandedOpexGroups[grp.key] ?? (grp.rows.length > 1);
  const allPnlGroupsExpanded = pnlOpexWaterfall.every((g) => isGroupExpanded(g));

  return (
    <section className="financial-center-panel" aria-label="Financial Management & Asset Reconciliation Center">
      <div className="financial-center-header">
        <div className="financial-center-title">
          <h3>
            <Scale size={20} aria-hidden="true" />
            Double-Entry Financial Management &amp; Asset Reconciliation
          </h3>
          <p>Full audit trail of store assets, operating profit, cash flows, balance sheet equilibrium, and shift reconciliations</p>
        </div>

        <div className="fin-action-toolbar">
          <div className="fin-toolbar-cluster" role="group" aria-label="Expenses and Period-End Actions">
            <span className="fin-toolbar-cluster-label">Expenses &amp; Period-End</span>
            <div className="fin-toolbar-cluster-actions">
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("opex")}
              >
                <PlusCircle size={14} aria-hidden="true" /> Record OPEX
              </button>
              {openAp2010Display > 0 && (
                <button
                  type="button"
                  className="fin-action-btn is-alert-ap"
                  onClick={() => openActionModal("settle", { liabilityCode: "2010" })}
                >
                  Unpaid Bills: {peso(openAp2010Display)} &rarr; Settle
                </button>
              )}
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("depreciation")}
              >
                <PlusCircle size={14} aria-hidden="true" /> Depreciation
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("income_tax")}
              >
                <PlusCircle size={14} aria-hidden="true" /> Income Tax
              </button>
            </div>
          </div>

          <div className="fin-toolbar-cluster" role="group" aria-label="Funds and Capital Actions">
            <span className="fin-toolbar-cluster-label">Funds &amp; Capital</span>
            <div className="fin-toolbar-cluster-actions">
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("drawing")}
              >
                <Wallet size={14} aria-hidden="true" /> Owner Drawing
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("capital")}
              >
                <PlusCircle size={14} aria-hidden="true" /> Capital Injection
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("transfer")}
              >
                <ArrowLeftRight size={14} aria-hidden="true" /> Transfer Funds
              </button>
            </div>
          </div>

          {activeTab !== "balancesheet" && (
            <div className="fin-date-filters">
              <label htmlFor="fin-filter-from">
                From
                <input
                  id="fin-filter-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                />
              </label>
              <label htmlFor="fin-filter-to">
                To
                <input
                  id="fin-filter-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                >
                  Clear Dates
                </button>
              )}
            </div>
          )}
        </div>

        <div className="financial-tabs-nav" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "recon"}
            className={`financial-tab-btn ${activeTab === "recon" ? "active" : ""}`}
            onClick={() => setActiveTab("recon")}
          >
            <Calendar size={14} aria-hidden="true" />
            Daily Asset Reconciliation
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pnl"}
            className={`financial-tab-btn ${activeTab === "pnl" ? "active" : ""}`}
            onClick={() => setActiveTab("pnl")}
          >
            <TrendingUp size={14} aria-hidden="true" />
            Profit &amp; Loss (P&amp;L)
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cashflow"}
            className={`financial-tab-btn ${activeTab === "cashflow" ? "active" : ""}`}
            onClick={() => setActiveTab("cashflow")}
          >
            <Wallet size={14} aria-hidden="true" />
            Cash Flow
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "balancesheet"}
            className={`financial-tab-btn ${activeTab === "balancesheet" ? "active" : ""}`}
            onClick={() => setActiveTab("balancesheet")}
          >
            <Scale size={14} aria-hidden="true" />
            Balance Sheet
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "journal"}
            className={`financial-tab-btn ${activeTab === "journal" ? "active" : ""}`}
            onClick={() => setActiveTab("journal")}
          >
            <BookOpen size={14} aria-hidden="true" />
            Journal Audit
          </button>
        </div>
      </div>

      <div className="financial-tab-content">
        {notice && (
          <div className="fin-banner is-success" role="status" aria-live="polite">
            <span>
              <CheckCircle2 size={15} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              {notice}
            </span>
            <button type="button" className="fin-banner-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss notice">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {dateInvalid && (
          <div className="fin-banner is-error" role="alert">
            <span>
              <AlertCircle size={15} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              The start date cannot be later than the end date.
            </span>
          </div>
        )}

        {loading && <div className="fin-loading-state">Loading financial records…</div>}

        {error && (
          <div className="fin-banner is-error" role="alert">
            <span>
              <AlertCircle size={16} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              {error}
            </span>
          </div>
        )}

        {/* TAB 1: DAILY ASSET RECONCILIATION */}
        {!loading && activeTab === "recon" && (
          <>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Business Date</th>
                    <th>Shift Status</th>
                    <th>BOD Open Assets</th>
                    <th>EOD Close Assets</th>
                    <th>Net Asset Delta</th>
                    <th>Gross Sales</th>
                    <th>COGS</th>
                    <th>Net Profit</th>
                    <th>Drawer Variance</th>
                    <th>Opened / Closed By</th>
                  </tr>
                </thead>
                <tbody>
                  {reconData.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "#8b5e3c", padding: "4rem 2rem" }}>
                        No daily asset snapshots recorded yet. Open a cashier shift to record today&apos;s BOD snapshot.
                      </td>
                    </tr>
                  ) : (
                    reconData.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.businessDate}</strong></td>
                        <td>
                          <span className={row.status === "open" ? "status-badge-open" : "status-badge-closed"}>
                            {row.status}
                          </span>
                        </td>
                        <td>{peso(row.openingTotalAssets)}</td>
                        <td>{row.closingTotalAssets != null ? peso(row.closingTotalAssets) : "— In Progress —"}</td>
                        <td style={{ fontWeight: 700, color: (row.netAssetDelta || 0) >= 0 ? "#1e7047" : "#c53030" }}>
                          {row.netAssetDelta != null ? `${row.netAssetDelta >= 0 ? "+" : ""}${peso(row.netAssetDelta)}` : "—"}
                        </td>
                        <td>{peso(row.grossSales)}</td>
                        <td>{peso(row.cogsConsumed)}</td>
                        <td style={{ fontWeight: 600 }}>{peso(row.netOperatingProfit)}</td>
                        <td style={{ color: Number(row.drawerVariance || 0) === 0 ? "#5a4029" : (row.drawerVariance < 0 ? "#c53030" : "#1e7047") }}>
                          {row.drawerVariance != null ? peso(row.drawerVariance) : "—"}
                        </td>
                        <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>
                          {row.openedByName || "System"}{row.closedByName ? ` / ${row.closedByName}` : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {reconMaxPage > 1 && (
              <div className="fin-pagination">
                <button type="button" disabled={reconPage <= 1} onClick={() => setReconPage((p) => Math.max(1, p - 1))}>Previous</button>
                <span>Page {reconPage} of {reconMaxPage}</span>
                <button type="button" disabled={reconPage >= reconMaxPage} onClick={() => setReconPage((p) => Math.min(reconMaxPage, p + 1))}>Next</button>
              </div>
            )}
          </>
        )}

        {/* TAB 2: PROFIT & LOSS WATERFALL */}
        {!loading && activeTab === "pnl" && pnlData && (
          <div className="fin-statement-stack">
            <div className="fin-statement-row">
              <span>Gross Sales (4010 — ex-VAT)</span>
              <strong>{peso(pnlData.grossSales)}</strong>
            </div>

            <div className="fin-statement-row is-deduction">
              <span>Less: Sales Discounts &amp; Promos (4020)</span>
              <span>- {peso(pnlData.discounts)}</span>
            </div>

            <div className="fin-statement-row is-subtotal">
              <span>Net Revenue / Sales (ex-VAT)</span>
              <span>{peso(pnlData.netSales)}</span>
            </div>

            <div className="fin-statement-card">
              <div className="fin-statement-card-total" style={{ marginTop: 0, paddingTop: 0, borderTop: "none", color: "#b91c1c" }}>
                <span>Less: Total Cost of Goods Sold (COGS)</span>
                <span>- {peso(pnlData.cogs)}</span>
              </div>
              <div className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#6b5847" }}>
                <span>5010 - Customer Sales (F&amp;B &amp; Ingredients Used)</span>
                <span>{peso(pnlData.customerSalesCogs ?? pnlData.cogs)}</span>
              </div>
              <div className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#6b5847" }}>
                <span>6030 - Food Spoilage &amp; Waste</span>
                <span>{peso(pnlData.foodSpoilageCogs ?? 0)}</span>
              </div>
            </div>

            <div className="fin-statement-row is-profit-band">
              <span>Gross Operating Profit (Margin: {pnlData.grossMarginPercent}%)</span>
              <span>{peso(pnlData.grossProfit)}</span>
            </div>

            <div className="fin-statement-card">
              <div className="fin-opex-head-bar">
                <div className="fin-statement-card-total" style={{ marginTop: 0, paddingTop: 0, borderTop: "none", flex: 1 }}>
                  <span>Operating Expenses (OPEX — 8 Categories)</span>
                  <span>
                    {pnlData.totalOperatingExpenses >= 0
                      ? `- ${peso(pnlData.totalOperatingExpenses)}`
                      : `+ ${peso(Math.abs(pnlData.totalOperatingExpenses))}`}
                  </span>
                </div>
                <div className="fin-opex-head-actions">
                  <button
                    type="button"
                    className="fin-inline-cta"
                    onClick={() => {
                      const targetState = !allPnlGroupsExpanded;
                      const next = {};
                      for (const g of pnlOpexWaterfall) next[g.key] = targetState;
                      setExpandedOpexGroups(next);
                    }}
                  >
                    {allPnlGroupsExpanded ? "Collapse All" : "Expand All"}
                  </button>
                  <button
                    type="button"
                    className="fin-inline-cta"
                    onClick={() => setShowZeroOpexGroups((prev) => !prev)}
                  >
                    {showZeroOpexGroups ? "Hide ₱0 Groups" : "Show ₱0 Groups"}
                  </button>
                </div>
              </div>

              {pnlOpexWaterfall
                .filter((grp) => showZeroOpexGroups || grp.rows.length > 0 || grp.subtotal !== 0)
                .map((grp) => {
                  const isExpanded = isGroupExpanded(grp);
                  const isZero = grp.rows.length === 0 && grp.subtotal === 0;
                  return (
                    <div key={grp.key} className="fin-opex-group">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        className={`fin-opex-group-toggle ${isZero ? "is-zero" : ""}`}
                        onClick={() =>
                          setExpandedOpexGroups((prev) => ({
                            ...prev,
                            [grp.key]: !(prev[grp.key] ?? (grp.rows.length > 1)),
                          }))
                        }
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                          {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          {grp.label}
                        </span>
                        <span>{peso(grp.subtotal)}</span>
                      </button>

                      {isExpanded && (
                        <div className="fin-opex-sublist">
                          {grp.rows.length === 0 ? (
                            <div className="fin-statement-line" style={{ fontSize: "0.79rem", color: "#6b5847" }}>
                              <span>No postings in selected period</span>
                              <span>{peso(0)}</span>
                            </div>
                          ) : (
                            grp.rows.map((exp) => (
                              <div key={exp.accountCode} className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#4a2c11" }}>
                                <span>{exp.accountCode} - {exp.accountName}</span>
                                <span>{peso(exp.amount)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="fin-statement-row is-ebitda">
              <span>EBITDA / Operating Income</span>
              <span>{peso(pnlData.ebitdaOperatingIncome)}</span>
            </div>

            <div className="fin-statement-row is-deduction">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <span>Less: Depreciation &amp; Amortization (6210)</span>
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => openActionModal("depreciation")}
                >
                  + Record Depreciation
                </button>
              </span>
              <span>- {peso(pnlData.depreciation)}</span>
            </div>

            <div className="fin-statement-row is-subtotal">
              <span>Net Income Before Tax (EBT)</span>
              <span>{peso(nibtValue)}</span>
            </div>

            <div className="fin-statement-row is-deduction">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <span>Less: Income Tax Expense (6310)</span>
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => openActionModal("income_tax")}
                >
                  + Record Income Tax
                </button>
              </span>
              <span>- {peso(pnlData.tax)}</span>
            </div>

            <div className="fin-summary-hero">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem" }}>
                <span>NET INCOME (BOTTOM-LINE PROFIT)</span>
                <small style={{ fontSize: "0.73rem", fontWeight: 500, color: "#e6d7c4" }}>
                  Net Revenue &minus; COGS &minus; OPEX &minus; Depreciation &minus; Income Tax &middot; Net Margin: {netMarginPercent}%
                </small>
              </div>
              <span style={{ color: netIncomeValue >= 0 ? "#92e0be" : "#fca5a5" }}>
                {peso(netIncomeValue)}
              </span>
            </div>
          </div>
        )}

        {/* TAB 3: CASH FLOW STATEMENT */}
        {!loading && activeTab === "cashflow" && (
          <CashFlowTabView cfData={cfData} peso={peso} />
        )}

        {/* TAB 4: BALANCE SHEET */}
        {!loading && activeTab === "balancesheet" && (
          <BalanceSheetTabView bsData={bsData} peso={peso} openActionModal={openActionModal} />
        )}

        {/* TAB 5: JOURNAL AUDIT */}
        {!loading && activeTab === "journal" && (
          <JournalAuditTabView
            journalData={journalData}
            journalPage={journalPage}
            journalMaxPage={journalMaxPage}
            setJournalPage={setJournalPage}
            peso={peso}
            onSelectReverse={(e) => {
              setReverseTarget(e);
              setReverseReason("");
              setFormError(null);
              setFormErrorField(null);
            }}
          />
        )}
      </div>

      {/* SHARED ACCESSIBLE MODAL FOR PHASE 1 + PHASE 2 FINANCIAL ACTIONS */}
      <FinDialog
        isOpen={Boolean(actionModal)}
        onClose={() => setActionModal(null)}
        busy={formSubmitting}
        titleId="fin-action-modal-title"
        maxWidth={actionModal === "depreciation" || actionModal === "income_tax" ? "520px" : "480px"}
        title={
          actionModal === "opex"
            ? "Record Operating Expense (OPEX)"
            : actionModal === "settle"
              ? (settleLiabilityCode === "2030" ? "Pay Income Tax (2030 Tax Payable)" : "Settle Unpaid Bills (2010 AP)")
              : actionModal === "depreciation"
                ? "Record Equipment Depreciation"
                : actionModal === "income_tax"
                  ? "Record Business Income Tax"
                  : actionModal === "drawing"
                    ? "Record Owner Drawing"
                    : actionModal === "capital"
                      ? "Record Capital Injection"
                      : "Transfer Between Liquid Accounts"
        }
      >
        <form onSubmit={handleActionSubmit} className="fin-modal-body" style={{ padding: "1.25rem 1.4rem" }}>
          {formError && (
            <div id="fin-modal-form-error" className="fin-form-error" role="alert">
              {formError}
            </div>
          )}

          {/* 1. RECORD OPEX */}
          {actionModal === "opex" && (
            <>
              <div className="fin-form-group">
                <label htmlFor="fin-opex-account">Expense Account (8 OPEX Categories) *</label>
                <select
                  id="fin-opex-account"
                  className="fin-form-input"
                  value={formExpenseCode}
                  onChange={(e) => {
                    const nextCode = e.target.value;
                    setFormExpenseCode(nextCode);
                    const nextCategories = EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(nextCode)).sort((a, b) => a.accountCodes.length - b.accountCodes.length);
                    setFormExpenseCategory(nextCategories[0]?.slug || "");
                  }}
                >
                  {groupedOpexAccounts.length > 0 ? (
                    groupedOpexAccounts.map((grp) => (
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.rows.map((acc) => (
                          <option key={acc.accountCode} value={acc.accountCode}>
                            {acc.accountCode} - {acc.accountName}{acc.accountCode === "6020" ? " (Legacy)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  ) : (
                    <>
                      <option value="6120">6120 - Rent &amp; Occupancy</option>
                      <option value="6131">6131 - Electricity</option>
                      <option value="6140">6140 - Operating Supplies</option>
                      <option value="6144">6144 - Sanitation Supplies</option>
                      <option value="6172">6172 - Taxes &amp; Licenses (Permits)</option>
                      <option value="6010">6010 - Operating Expenses (OPEX)</option>
                    </>
                  )}
                </select>
              </div>

              <div className="fin-form-group">
                <label htmlFor="fin-opex-budget-category">Budget Category</label>
                <select
                  id="fin-opex-budget-category"
                  className="fin-form-input"
                  value={formExpenseCategory}
                  onChange={(e) => setFormExpenseCategory(e.target.value)}
                >
                  <option value="">No budget category (unassigned account)</option>
                  {EXPENSE_NAV_CATEGORIES.filter((category) => category.accountCodes.includes(String(formExpenseCode))).map((category) => (
                    <option key={category.slug} value={category.slug}>{category.label}</option>
                  ))}
                </select>
                <small>Choose the closest category to apply its monthly budget. Older entries without a category assignment may be matched to each category using the same ledger account.</small>
              </div>

              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4a2c11", marginBottom: "0.35rem" }}>
                  Payment Status *
                </legend>
                <div className="fin-radio-grid" role="radiogroup" aria-label="OPEX payment status">
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
                    <small>Deducts Cash / GCash / Bank</small>
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
                    <small>Adds to 2010 Accounts Payable</small>
                  </button>
                </div>
              </fieldset>

              {formPaymentStatus === "paid" ? (
                <div className="fin-form-group">
                  <label htmlFor="fin-opex-liquid">Paid From (Liquid Account) *</label>
                  <select
                    id="fin-opex-liquid"
                    className="fin-form-input"
                    value={formPrimaryAccount}
                    onChange={(e) => setFormPrimaryAccount(e.target.value)}
                  >
                    {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="fin-callout">
                    Posts expense to the Income Statement now and adds to <strong>2010 Accounts Payable</strong>. Cash drawer is NOT deducted.
                  </div>
                  <div className="fin-two-col">
                    <div className="fin-form-group">
                      <label htmlFor="fin-opex-vendor">Vendor / Payee (Optional)</label>
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
                  Current Open {settleLiabilityCode === "2030" ? "Income Tax Payable (2030)" : "Accounts Payable (2010)"}:{" "}
                  <strong>{peso(settleLiabilityCode === "2030" ? openTax2030Display : openAp2010Display)}</strong>
                </div>
                <small style={{ color: "#6b5847" }}>
                  Settling this liability reduces cash and clears an existing payable &mdash; it does NOT double-count on your P&amp;L.
                </small>
              </div>

              {matchingOpenPayables.length > 0 && (
                <div className="fin-form-group">
                  <label htmlFor="fin-settle-bill-select">Select Unpaid Bill *</label>
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
                <label htmlFor="fin-settle-liquid">Pay From (Liquid Account) *</label>
                <select
                  id="fin-settle-liquid"
                  className="fin-form-input"
                  value={formPrimaryAccount}
                  onChange={(e) => setFormPrimaryAccount(e.target.value)}
                >
                  {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
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
                  <strong>Non-Cash Adjustment:</strong> Posts <strong>DR 6210 Depreciation Expense / CR 1520 Accumulated Depreciation</strong>.
                  Does NOT deduct Cash, GCash, or Bank accounts.
                </div>
                <div style={{ marginTop: "0.25rem", color: "#4a2c11" }}>
                  1510 Gross Equipment: <strong>{peso(grossEquip1510)}</strong> &middot; Net Book Value (1510 &minus; 1520):{" "}
                  <strong>{peso(equipmentNetBookValue)}</strong>
                </div>
              </div>

              {equipmentNetBookValue <= 0 && (
                <div className="fin-form-error" role="status">
                  No remaining Equipment Net Book Value (1510 &minus; 1520 = ₱0.00) available to depreciate.
                </div>
              )}

              <details
                className="fin-estimator-details"
                open={estimatorOpen}
                onToggle={(e) => setEstimatorOpen(e.currentTarget.open)}
              >
                <summary>
                  {estimatorOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  Straight-Line Monthly Estimator (Optional)
                </summary>
                <div className="fin-two-col" style={{ marginTop: "0.6rem" }}>
                  <div className="fin-form-group">
                    <label htmlFor="fin-depr-cost">Equipment Cost (₱)</label>
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
                    <label htmlFor="fin-depr-months">Useful Life (Months)</label>
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
                  Period Net Income Before Tax: <strong>{peso(nibtValue)}</strong>
                  {nibtRefreshing && <small style={{ marginLeft: "0.45rem", color: "#6b5847" }}>(Refreshing…)</small>}
                </div>
                <small style={{ color: "#6b5847" }}>
                  Business Income Tax (6310 / 2030) is strictly separate from Order Sales VAT (2020) collected from customers.
                </small>
              </div>

              <div className="fin-form-group">
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4a2c11" }}>
                  Quick Tax Estimate (% of Net Income Before Tax)
                </span>
                <div className="fin-preset-row">
                  {[8, 15, 20, 25].map((pct) => {
                    const est = nibtValue > 0 ? round2((nibtValue * pct) / 100) : 0;
                    return (
                      <button
                        key={pct}
                        type="button"
                        className="fin-preset-chip"
                        disabled={nibtValue <= 0}
                        onClick={() => {
                          setFormAmount(est.toFixed(2));
                          setFormMemo(`Income Tax Estimate (${pct}% of ${peso(nibtValue)} NIBT)`);
                        }}
                      >
                        {pct}%{nibtValue > 0 ? ` (${peso(est)})` : ""}
                      </button>
                    );
                  })}
                </div>
                {nibtValue <= 0 && (
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
                    <small>Deducts Cash / Bank / E-Wallet</small>
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
                    <strong><span aria-hidden="true">{formPaymentStatus === "unpaid" ? "●" : "○"}</span> Unpaid / Tax Payable</strong>
                    <small>Adds to 2030 Income Tax Payable</small>
                  </button>
                </div>
              </fieldset>

              {formPaymentStatus === "paid" ? (
                <div className="fin-form-group">
                  <label htmlFor="fin-tax-liquid">Paid From (Liquid Account) *</label>
                  <select
                    id="fin-tax-liquid"
                    className="fin-form-input"
                    value={formPrimaryAccount}
                    onChange={(e) => setFormPrimaryAccount(e.target.value)}
                  >
                    {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="fin-two-col">
                  <div className="fin-form-group">
                    <label htmlFor="fin-tax-vendor">Tax Authority / Period (Optional)</label>
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
                    ? "Deposit Into Account *"
                    : actionModal === "transfer"
                      ? "Transfer From Account *"
                      : "Paid From Account *"}
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
                  {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {actionModal === "transfer" && (
                <div className="fin-form-group">
                  <label htmlFor="fin-secondary-liquid">Transfer Into Account *</label>
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
                    {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
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
            <label htmlFor="fin-action-memo">Audit Memo *</label>
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
                ? "Posting…"
                : actionModal === "settle"
                  ? "Confirm Payment"
                  : actionModal === "depreciation"
                    ? "Post Depreciation"
                    : actionModal === "income_tax"
                      ? "Post Income Tax"
                      : "Post Balanced Entry"}
            </button>
          </div>
        </form>
      </FinDialog>

      {/* SHARED ACCESSIBLE REVERSAL DIALOG */}
      <FinDialog
        isOpen={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        busy={formSubmitting}
        titleId="fin-reverse-modal-title"
        maxWidth="440px"
        title={reverseTarget ? `Reverse Journal Entry ${reverseTarget.entryNumber}` : "Reverse Journal Entry"}
      >
        <form onSubmit={handleConfirmReverse} className="fin-modal-body" style={{ padding: "1.25rem 1.4rem" }}>
          {formError && (
            <div id="fin-reverse-form-error" className="fin-form-error" role="alert">
              {formError}
            </div>
          )}
          <div className="fin-form-group">
            <label htmlFor="fin-reverse-reason">Audited Reversal Reason (min 3 characters) *</label>
            <textarea
              ref={reverseReasonRef}
              id="fin-reverse-reason"
              rows={3}
              required
              maxLength={255}
              aria-invalid={formErrorField === "reverseReason"}
              aria-describedby={formErrorField === "reverseReason" ? "fin-reverse-form-error" : undefined}
              className="fin-form-input"
              value={reverseReason}
              onChange={(e) => {
                setReverseReason(e.target.value);
                if (formErrorField === "reverseReason") {
                  setFormError(null);
                  setFormErrorField(null);
                }
              }}
              placeholder="Explain why this entry is being reversed…"
            />
          </div>
          <div className="fin-modal-footer" style={{ margin: "0.35rem -1.4rem -1.25rem", padding: "0.95rem 1.4rem" }}>
            <button
              type="button"
              className="fin-modal-btn-secondary"
              disabled={formSubmitting}
              onClick={() => setReverseTarget(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fin-modal-btn-danger"
              disabled={formSubmitting}
              aria-busy={formSubmitting}
            >
              {formSubmitting ? "Reversing…" : "Post Reversal"}
            </button>
          </div>
        </form>
      </FinDialog>
    </section>
  );
}
