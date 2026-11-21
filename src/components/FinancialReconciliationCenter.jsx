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
  Lock,
  Download,
  Search,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { peso, round2, manilaToday } from "../utils/financeFormat.js";
import MonthClosePanel from "./admin/finances/MonthClosePanel.jsx";
import ProfitReportTabView from "./admin/finances/ProfitReportTabView.jsx";
import ReconTabView from "./admin/finances/ReconTabView.jsx";
import ReverseDialog from "./admin/finances/ReverseDialog.jsx";
import FinanceActionDialog from "./admin/finances/FinanceActionDialog.jsx";
import { isManualExpenseAccount } from "./admin/finances/financeAccounts.js";
import { downloadCsv } from "../utils/financeCsv.js";
import { reconRows, journalRows, profitReportRows, cashFlowRows, balanceSheetRows } from "../utils/financeExport.js";
import { useNetIncomePin } from "../hooks/useNetIncomePin.js";
import NetIncomePinModal from "./NetIncomePinModal.jsx";
import { FIN_TABS, FIN_ACTIONS, entryTypeLabel } from "../config/financeLabels.js";

import { BalanceSheetTabView, CashFlowTabView, JournalAuditTabView } from "./admin/finances/FinancialStatementTabs.jsx";
import "../assets/css/admin/FinancialManagement.css";

const LIQUID_ACCOUNT_CODES_LIST = ["1010", "1020", "1030", "1040"];

// Fallback used until the chart of accounts has loaded.
const LIQUID_ACCOUNT_OPTIONS = [
  { code: "1010", label: "1010 - Cash Drawer (Counter 1)" },
  { code: "1020", label: "1020 - GCash Official Wallet" },
  { code: "1030", label: "1030 - Store Bank Account" },
  { code: "1040", label: "1040 - Owner Capital Reserve" },
];

// USAR order: labor, controllable expenses, then occupancy.
const OPEX_GROUP_ORDER = [
  "Labor & Payroll",
  "Utilities",
  "Marketing",
  "Operating Supplies",
  "Repairs & Maintenance",
  "General & Administrative (G&A)",
  "Others",
  "Utilities & Rent (Legacy)",
  "Occupancy",
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

export default function FinancialReconciliationCenter() {
  const netIncomePin = useNetIncomePin();
  const [activeTab, setActiveTab] = useState("recon"); // 'recon', 'pnl', 'cashflow', 'balancesheet', 'journal'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filters & Pagination
  const [showCodes, setShowCodes] = useState(false);
  const [drawerThresholds, setDrawerThresholds] = useState({ ok: 50, review: 200 });
  const [limitsLoaded, setLimitsLoaded] = useState(false);
  const [monthCloseOpen, setMonthCloseOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Journal search: the text box updates `journalSearchInput` at once; `journalSearch` follows after a short pause.
  const [journalSearchInput, setJournalSearchInput] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalType, setJournalType] = useState("");
  const [journalMin, setJournalMin] = useState("");
  const [journalMax, setJournalMax] = useState("");
  // Account codes (1010, 6120...) are for accountants; plain names are shown unless asked for.
  const withCode = (code, text) => (showCodes ? `${code} - ${text}` : text);
  const [asOfDate, setAsOfDate] = useState("");
  const [tabLoaded, setTabLoaded] = useState({});
  const [reloadTick, setReloadTick] = useState(0);
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

  // Reversal & Action Modals
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState("");

  const isMountedRef = useRef(true);
  const reverseReasonRef = useRef(null);
  const actionDialogRef = useRef(null);
  // The reverse dialog keeps its own submit/error state so it never mixes with the money pop-ups.
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formErrorField, setFormErrorField] = useState(null);

  const openActionModal = (mode, opts = {}) => actionDialogRef.current?.open(mode, opts);

  const focusReverseReason = () => {
    window.requestAnimationFrame(() => reverseReasonRef.current?.focus());
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setJournalSearch((prev) => {
        const next = journalSearchInput.trim();
        return prev === next ? prev : next;
      });
      setJournalPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [journalSearchInput]);

  const journalFilterParams = useMemo(() => ({
    q: journalSearch,
    type: journalType,
    minAmount: journalMin,
    maxAmount: journalMax,
  }), [journalSearch, journalType, journalMin, journalMax]);

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
      const [accRes, payRes, limitsRes] = await Promise.all([
        apiRequest("/finances/accounts"),
        apiRequest("/finances/payables?status=open"),
        apiRequest("/finances/drawer-thresholds").catch(() => null),
      ]);
      if (!isMountedRef.current) return;
      if (Array.isArray(accRes?.accounts)) {
        setCoaAccounts(accRes.accounts);
      }
      if (Array.isArray(payRes?.items)) {
        setOpenPayables(payRes.items);
      }
      if (payRes?.totals) {
        setPayablesTotals(payRes.totals);
      }
      if (limitsRes && Number.isFinite(Number(limitsRes.ok)) && Number.isFinite(Number(limitsRes.review))) {
        setDrawerThresholds({ ok: Number(limitsRes.ok), review: Number(limitsRes.review) });
        setLimitsLoaded(true);
      }
    } catch {
      // ignore background refresh error; main tab loader surfaces connection errors
    }
  }, []);

  // One place loads the account list and open bills: on mount, and again after every change.
  useEffect(() => {
    const timer = window.setTimeout(loadMeta, 0);
    return () => window.clearTimeout(timer);
  }, [loadMeta]);

  useEffect(() => {
    let active = true;

    const loadTab = async () => {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === "recon") {
          const res = await apiRequest(`/finances/reports/daily-reconciliation${buildDateParams({ page: reconPage, limit: 25 })}`, { headers: netIncomePin.financialHeaders });
          if (!active) return;
          setReconData(res.items || []);
          setReconTotal(Number(res.total || 0));
          // Never stay on a page that no longer exists (entries removed, filters narrowed).
          const lastReconPage = Math.max(1, Math.ceil(Number(res.total || 0) / 25));
          if (reconPage > lastReconPage) setReconPage(lastReconPage);
        } else if (activeTab === "pnl") {
          const res = await apiRequest(`/finances/reports/profit-and-loss${buildDateParams()}`, { headers: netIncomePin.financialHeaders });
          if (!active) return;
          setPnlData(res);
        } else if (activeTab === "cashflow") {
          const res = await apiRequest(`/finances/reports/cash-flow${buildDateParams()}`, { headers: netIncomePin.financialHeaders });
          if (!active) return;
          setCfData(res);
        } else if (activeTab === "balancesheet") {
          const res = await apiRequest(`/finances/reports/balance-sheet${asOfDate ? `?asOf=${encodeURIComponent(asOfDate)}` : ""}`, { headers: netIncomePin.financialHeaders });
          if (!active) return;
          setBsData(res);
        } else if (activeTab === "journal") {
          const res = await apiRequest(`/finances/journal-entries${buildDateParams({ page: journalPage, limit: 25, ...journalFilterParams })}`, { headers: netIncomePin.financialHeaders });
          if (!active) return;
          setJournalData(res.items || []);
          setJournalTotal(Number(res.total || 0));
          const lastJournalPage = Math.max(1, Math.ceil(Number(res.total || 0) / 25));
          if (journalPage > lastJournalPage) setJournalPage(lastJournalPage);
        }
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load financial records.");
      } finally {
        if (active) {
          setLoading(false);
          setTabLoaded((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
        }
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
  }, [activeTab, buildDateParams, journalPage, reconPage, loadMeta, netIncomePin.financialHeaders, asOfDate, reloadTick, journalFilterParams]);

  // A tab's first load shows "Loading"; later refreshes keep the old figures on screen.
  const tabReady = !loading || Boolean(tabLoaded[activeTab]);

  const accountBalanceMap = useMemo(() => {
    const map = new Map();
    for (const acc of coaAccounts) {
      map.set(acc.accountCode, round2(acc.balance));
    }
    return map;
  }, [coaAccounts]);

  const liquidAccountOptions = useMemo(() => {
    const fromChart = LIQUID_ACCOUNT_CODES_LIST
      .map((code) => coaAccounts.find((a) => a.accountCode === code))
      .filter(Boolean)
      .map((a) => ({ code: a.accountCode, label: a.accountName }));
    return (fromChart.length ? fromChart : LIQUID_ACCOUNT_OPTIONS).map((opt) => ({
      ...opt,
      label: showCodes ? `${opt.code} - ${String(opt.label).replace(/^\d{4} - /, "")}` : String(opt.label).replace(/^\d{4} - /, ""),
    }));
  }, [coaAccounts, showCodes]);

  const groupedOpexAccounts = useMemo(
    // Payroll accounts (salaries, wages, OT, contributions, 13th month) are posted by Payroll Runs only.
    () => groupOpexByExpenseGroup(coaAccounts.filter(isManualExpenseAccount)),
    [coaAccounts],
  );

  const grossEquip1510 = accountBalanceMap.get("1510") || 0;
  const accumDepr1520 = accountBalanceMap.get("1520") || 0;
  const equipmentNetBookValue = round2(Math.max(0, grossEquip1510 - accumDepr1520));

  const openAp2010Display = round2(Math.max(payablesTotals.unpaidAp2010 || 0, payablesTotals.glAp2010Balance || 0));
  const openTax2030Display = round2(Math.max(payablesTotals.unpaidTax2030 || 0, payablesTotals.glTax2030Balance || 0));

  const handleConfirmReverse = async (e) => {
    e.preventDefault();
    if (formSubmitting) return;
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (reason.length < 3) {
      setFormError("Please say why you are cancelling this (at least 3 characters).");
      setFormErrorField("reverseReason");
      focusReverseReason();
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
      setNotice(`Transaction ${reverseTarget.entryNumber} was cancelled. The original stays in the history.`);
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "We could not cancel this. Please try again.");
      setFormErrorField("form");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const stamp = manilaToday();
      if (activeTab === "recon") {
        downloadCsv(`daily-cash-stock-check-${stamp}.csv`, reconRows(reconData));
      } else if (activeTab === "pnl") {
        downloadCsv(`profit-report-${stamp}.csv`, profitReportRows(pnlData));
      } else if (activeTab === "cashflow") {
        downloadCsv(`money-in-and-out-${stamp}.csv`, cashFlowRows(cfData));
      } else if (activeTab === "balancesheet") {
        downloadCsv(`what-we-own-and-owe-${asOfDate || stamp}.csv`, balanceSheetRows(bsData));
      } else {
        // The whole filtered history, not just the page on screen (up to 5,000 entries).
        const all = [];
        for (let page = 1; page <= 50; page += 1) {
          const res = await apiRequest(`/finances/journal-entries${buildDateParams({ page, limit: 100, ...journalFilterParams })}`, { headers: netIncomePin.financialHeaders });
          all.push(...(res.items || []));
          if (all.length >= Number(res.total || 0) || !(res.items || []).length) break;
        }
        downloadCsv(`transaction-history-${stamp}.csv`, journalRows(all));
      }
      setNotice("Your CSV file was downloaded. Figures hidden by the Net Income PIN stay blank in it.");
    } catch (err) {
      setError(err?.message || "We could not make the file. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleTabKeyDown = (event) => {
    const order = ["recon", "pnl", "cashflow", "balancesheet", "journal"];
    const index = order.indexOf(activeTab);
    let next = null;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (!next) return;
    event.preventDefault();
    setActiveTab(next);
    window.requestAnimationFrame(() => document.getElementById(`fin-tab-${next}`)?.focus());
  };

  const dateInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const reconMaxPage = Math.max(1, Math.ceil(reconTotal / 25));
  const journalMaxPage = Math.max(1, Math.ceil(journalTotal / 25));

  return (
    <section className="financial-center-panel" aria-label="Money and Books">
      <div className="financial-center-header">
        <div className="financial-center-title">
          <h3>
            <Scale size={20} aria-hidden="true" />
            <span title="Double-entry financial management and asset reconciliation">Money &amp; Books</span>
          </h3>
          <p>Where your money is, what you earned, what you owe, and a full history of every change.</p>
        </div>

        <div className="fin-action-toolbar">
          <div className="fin-toolbar-cluster" role="group" aria-label="Expenses and adjustments">
            <span className="fin-toolbar-cluster-label">Expenses &amp; Adjustments</span>
            <div className="fin-toolbar-cluster-actions">
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("opex")}
              >
                <PlusCircle size={14} aria-hidden="true" /> {FIN_ACTIONS.expense.label}
              </button>
              {openAp2010Display > 0 && (
                <button
                  type="button"
                  className="fin-action-btn is-alert-ap"
                  onClick={() => openActionModal("settle", { liabilityCode: "2010" })}
                >
                  Unpaid Bills: {peso(openAp2010Display)} &rarr; Pay Now
                </button>
              )}
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("depreciation")}
              >
                <PlusCircle size={14} aria-hidden="true" /> <span title={FIN_ACTIONS.wear.term}>{FIN_ACTIONS.wear.label}</span>
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("income_tax")}
              >
                <PlusCircle size={14} aria-hidden="true" /> <span title={FIN_ACTIONS.tax.term}>{FIN_ACTIONS.tax.label}</span>
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => setMonthCloseOpen(true)}
              >
                <Lock size={14} aria-hidden="true" /> Close the Month
              </button>
            </div>
          </div>

          <div className="fin-toolbar-cluster" role="group" aria-label="Owner money and transfers">
            <span className="fin-toolbar-cluster-label">Owner&apos;s Money &amp; Transfers</span>
            <div className="fin-toolbar-cluster-actions">
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("drawing")}
              >
                <Wallet size={14} aria-hidden="true" /> <span title={FIN_ACTIONS.withdrawal.term}>{FIN_ACTIONS.withdrawal.label}</span>
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("capital")}
              >
                <PlusCircle size={14} aria-hidden="true" /> <span title={FIN_ACTIONS.capital.term}>{FIN_ACTIONS.capital.label}</span>
              </button>
              <button
                type="button"
                className="fin-action-btn"
                onClick={() => openActionModal("transfer")}
              >
                <ArrowLeftRight size={14} aria-hidden="true" /> <span title={FIN_ACTIONS.transfer.term}>{FIN_ACTIONS.transfer.label}</span>
              </button>
            </div>
          </div>

          {activeTab === "balancesheet" && (
            <div className="fin-date-filters">
              <label htmlFor="fin-filter-asof">
                As of
                <input
                  id="fin-filter-asof"
                  type="date"
                  max={manilaToday()}
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </label>
              {asOfDate && (
                <button type="button" className="fin-inline-cta" onClick={() => setAsOfDate("")}>
                  Back to Today
                </button>
              )}
            </div>
          )}

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

        <label className="fin-codes-toggle" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "#6b5847", margin: "0.4rem 0" }}>
          <input type="checkbox" checked={showCodes} onChange={(e) => setShowCodes(e.target.checked)} />
          Show account numbers (for accountants)
        </label>

        <div className="financial-tabs-nav" role="tablist" aria-label="Money and Books sections" onKeyDown={handleTabKeyDown}>
          <button
            type="button"
            role="tab"
            id="fin-tab-recon"
            aria-controls="fin-tabpanel"
            tabIndex={activeTab === "recon" ? 0 : -1}
            aria-selected={activeTab === "recon"}
            className={`financial-tab-btn ${activeTab === "recon" ? "active" : ""}`}
            onClick={() => setActiveTab("recon")}
          >
            <Calendar size={14} aria-hidden="true" />
            <span title={FIN_TABS.recon.term}>{FIN_TABS.recon.label}</span>
          </button>

          <button
            type="button"
            role="tab"
            id="fin-tab-pnl"
            aria-controls="fin-tabpanel"
            tabIndex={activeTab === "pnl" ? 0 : -1}
            aria-selected={activeTab === "pnl"}
            className={`financial-tab-btn ${activeTab === "pnl" ? "active" : ""}`}
            onClick={() => setActiveTab("pnl")}
          >
            <TrendingUp size={14} aria-hidden="true" />
            <span title={FIN_TABS.pnl.term}>{FIN_TABS.pnl.label}</span>
          </button>

          <button
            type="button"
            role="tab"
            id="fin-tab-cashflow"
            aria-controls="fin-tabpanel"
            tabIndex={activeTab === "cashflow" ? 0 : -1}
            aria-selected={activeTab === "cashflow"}
            className={`financial-tab-btn ${activeTab === "cashflow" ? "active" : ""}`}
            onClick={() => setActiveTab("cashflow")}
          >
            <Wallet size={14} aria-hidden="true" />
            <span title={FIN_TABS.cashflow.term}>{FIN_TABS.cashflow.label}</span>
          </button>

          <button
            type="button"
            role="tab"
            id="fin-tab-balancesheet"
            aria-controls="fin-tabpanel"
            tabIndex={activeTab === "balancesheet" ? 0 : -1}
            aria-selected={activeTab === "balancesheet"}
            className={`financial-tab-btn ${activeTab === "balancesheet" ? "active" : ""}`}
            onClick={() => setActiveTab("balancesheet")}
          >
            <Scale size={14} aria-hidden="true" />
            <span title={FIN_TABS.balancesheet.term}>{FIN_TABS.balancesheet.label}</span>
          </button>

          <button
            type="button"
            role="tab"
            id="fin-tab-journal"
            aria-controls="fin-tabpanel"
            tabIndex={activeTab === "journal" ? 0 : -1}
            aria-selected={activeTab === "journal"}
            className={`financial-tab-btn ${activeTab === "journal" ? "active" : ""}`}
            onClick={() => setActiveTab("journal")}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span title={FIN_TABS.journal.term}>{FIN_TABS.journal.label}</span>
          </button>
        </div>
      </div>

      <div className="financial-tab-content" role="tabpanel" id="fin-tabpanel" aria-labelledby={`fin-tab-${activeTab}`}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
          <button type="button" className="fin-inline-cta" disabled={exporting || !tabReady} onClick={handleExportCsv} aria-busy={exporting}>
            <Download size={13} aria-hidden="true" /> {exporting ? "Preparing file…" : "Download CSV"}
          </button>
        </div>

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

        {loading && !tabReady && <div className="fin-loading-state">Loading financial records…</div>}
        {loading && tabReady && <div className="fin-loading-state" role="status" aria-live="polite">Refreshing…</div>}

        {error && (
          <div className="fin-banner is-error" role="alert">
            <span>
              <AlertCircle size={16} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              {error}
            </span>
            <button type="button" className="fin-inline-cta" onClick={() => setReloadTick((n) => n + 1)}>
              Try Again
            </button>
          </div>
        )}

        {/* TAB 1: DAILY CASH & STOCK CHECK */}
        {tabReady && activeTab === "recon" && (
          <ReconTabView
            key={limitsLoaded ? "limits-loaded" : "limits-default"}
            reconData={reconData}
            reconPage={reconPage}
            reconMaxPage={reconMaxPage}
            setReconPage={setReconPage}
            netIncomePin={netIncomePin}
            thresholds={drawerThresholds}
            onThresholdsSaved={setDrawerThresholds}
            fromDate={fromDate}
            toDate={toDate}
          />
        )}

        {/* TAB 2: PROFIT REPORT */}
        {tabReady && activeTab === "pnl" && pnlData && (
          <ProfitReportTabView
            pnlData={pnlData}
            netIncomePin={netIncomePin}
            withCode={withCode}
            openActionModal={openActionModal}
          />
        )}

        {/* TAB 3: CASH FLOW STATEMENT */}
        {tabReady && activeTab === "cashflow" && (
          <CashFlowTabView cfData={cfData} peso={peso} />
        )}

        {/* TAB 4: BALANCE SHEET */}
        {tabReady && activeTab === "balancesheet" && (
          <BalanceSheetTabView
            bsData={bsData}
            showCodes={showCodes}
            peso={peso}
            openActionModal={openActionModal}
            netIncomeUnlocked={netIncomePin.unlocked}
            onRequestNetIncome={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}
          />
        )}

        {/* TAB 5: JOURNAL AUDIT */}
        {tabReady && activeTab === "journal" && (
          <>
          <div className="fin-journal-filters" role="search" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 0.6rem" }}>
            <label htmlFor="fin-journal-search" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11", flex: "1 1 14rem" }}>
              Search notes, references or numbers
              <span style={{ position: "relative", display: "block" }}>
                <Search size={13} aria-hidden="true" style={{ position: "absolute", left: "0.55rem", top: "50%", transform: "translateY(-50%)", color: "#8b5e3c" }} />
                <input
                  id="fin-journal-search"
                  type="search"
                  className="fin-form-input"
                  style={{ paddingLeft: "1.8rem", width: "100%" }}
                  maxLength={100}
                  value={journalSearchInput}
                  onChange={(e) => setJournalSearchInput(e.target.value)}
                  placeholder="For example: rent, receipt 1234"
                />
              </span>
            </label>
            <label htmlFor="fin-journal-type" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11" }}>
              What it was
              <select
                id="fin-journal-type"
                className="fin-form-input"
                value={journalType}
                onChange={(e) => {
                  setJournalType(e.target.value);
                  setJournalPage(1);
                }}
              >
                <option value="">Everything</option>
                {["operating_expense", "ap_settlement", "income_tax", "depreciation", "capital_injection", "owner_withdrawal", "account_transfer", "adjustment", "inventory_restock", "opening_balance", "void_reversal"].map((type) => (
                  <option key={type} value={type}>{entryTypeLabel(type)}</option>
                ))}
              </select>
            </label>
            {netIncomePin.unlocked && (
              <>
                <label htmlFor="fin-journal-min" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11" }}>
                  Amount from (₱)
                  <input id="fin-journal-min" type="number" inputMode="decimal" min="0" step="0.01" className="fin-form-input fin-input-tabular" style={{ width: "7.5rem" }} value={journalMin}
                    onChange={(e) => { setJournalMin(e.target.value); setJournalPage(1); }} />
                </label>
                <label htmlFor="fin-journal-max" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11" }}>
                  to (₱)
                  <input id="fin-journal-max" type="number" inputMode="decimal" min="0" step="0.01" className="fin-form-input fin-input-tabular" style={{ width: "7.5rem" }} value={journalMax}
                    onChange={(e) => { setJournalMax(e.target.value); setJournalPage(1); }} />
                </label>
              </>
            )}
            {(journalSearchInput || journalType || journalMin || journalMax) && (
              <button
                type="button"
                className="fin-inline-cta"
                onClick={() => {
                  setJournalSearchInput("");
                  setJournalSearch("");
                  setJournalType("");
                  setJournalMin("");
                  setJournalMax("");
                  setJournalPage(1);
                }}
              >
                Clear Search
              </button>
            )}
          </div>
          <JournalAuditTabView
            journalData={journalData}
            showCodes={showCodes}
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
          </>
        )}
      </div>

      <FinanceActionDialog
        ref={actionDialogRef}
        coaAccounts={coaAccounts}
        openPayables={openPayables}
        payablesTotals={payablesTotals}
        liquidAccountOptions={liquidAccountOptions}
        groupedOpexAccounts={groupedOpexAccounts}
        withCode={withCode}
        netIncomePin={netIncomePin}
        pnlData={pnlData}
        onPnlRefreshed={setPnlData}
        buildDateParams={buildDateParams}
        grossEquip1510={grossEquip1510}
        equipmentNetBookValue={equipmentNetBookValue}
        openAp2010Display={openAp2010Display}
        openTax2030Display={openTax2030Display}
        onNotice={setNotice}
      />

      <ReverseDialog
        reverseTarget={reverseTarget}
        setReverseTarget={setReverseTarget}
        formSubmitting={formSubmitting}
        formError={formError}
        formErrorField={formErrorField}
        setFormError={setFormError}
        setFormErrorField={setFormErrorField}
        reverseReasonRef={reverseReasonRef}
        reverseReason={reverseReason}
        setReverseReason={setReverseReason}
        handleConfirmReverse={handleConfirmReverse}
      />
      <MonthClosePanel
        isOpen={monthCloseOpen}
        onClose={() => setMonthCloseOpen(false)}
        financialHeaders={netIncomePin.financialHeaders}
        unlocked={netIncomePin.unlocked}
        onRequestPin={() => {
          setMonthCloseOpen(false);
          netIncomePin.setModalOpen(true);
        }}
        onChanged={() => setReloadTick((n) => n + 1)}
      />
      <NetIncomePinModal
        open={netIncomePin.modalOpen}
        hasPin={netIncomePin.hasPin}
        onClose={() => netIncomePin.setModalOpen(false)}
        onUnlocked={(accessToken) => netIncomePin.unlock(accessToken)}
      />
    </section>
  );
}
