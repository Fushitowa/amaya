import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Coins,
  Landmark,
  Smartphone,
  PiggyBank,
  Package,
  Coffee,
  PlusCircle,
  RefreshCw,
  Wallet,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ArrowDownToLine,
  Calendar,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { useNetIncomePin } from "../hooks/useNetIncomePin.js";
import NetIncomePinModal from "./NetIncomePinModal.jsx";
import { createClientRequestId } from "../utils/clientRequestId.js";
import "../assets/css/admin/FinancialManagement.css";

function peso(val) {
  const num = Number(val || 0);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getManilaDateOffset(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default function StoreAssetsHeroCard() {
  const netIncomePin = useNetIncomePin();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const actionMenuRef = useRef(null);
  const capitalRequestIdRef = useRef(null);

  // Capital Registration / Owner Withdrawal Modal state
  const [modalType, setModalType] = useState("opening_balance"); // 'opening_balance' | 'withdraw'
  const [cashDrawer, setCashDrawer] = useState("");
  const [gcash, setGcash] = useState("");
  const [bank, setBank] = useState("");
  const [capitalReserve, setCapitalReserve] = useState("");
  const [equipment, setEquipment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);

  // Withdraw (3-Day Store Audit & Cash-Out) state
  const [withdrawPreset, setWithdrawPreset] = useState("3days");
  const [withdrawFrom, setWithdrawFrom] = useState(() => getManilaDateOffset(2));
  const [withdrawTo, setWithdrawTo] = useState(() => getManilaDateOffset(0));
  const [withdrawChannel, setWithdrawChannel] = useState("1010");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPeriodSummary, setWithdrawPeriodSummary] = useState(null);
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  const fetchFinancialAccounts = useCallback(async (range = null) => {
    try {
      setRefreshing(true);
      setError(null);
      const params = new URLSearchParams();
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);
      const qs = params.toString();
      const res = await apiRequest(`/finances/accounts${qs ? `?${qs}` : ""}`, { headers: netIncomePin.financialHeaders });
      setData(res);
      return res;
    } catch (err) {
      console.error("Failed to load store asset accounts:", err);
      setError(err?.message || "Could not retrieve store financial balances.");
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [netIncomePin.financialHeaders]);

  useEffect(() => {
    let active = true;
    const syncAccounts = () => {
      apiRequest("/finances/accounts", { headers: netIncomePin.financialHeaders })
        .then((res) => {
          if (!active) return;
          setData(res);
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setError(err?.message || "Could not retrieve store financial balances.");
          setLoading(false);
        });
    };

    syncAccounts();
    window.addEventListener("amaya:stock-mutated", syncAccounts);
    window.addEventListener("amaya:session-changed", syncAccounts);
    return () => {
      active = false;
      window.removeEventListener("amaya:stock-mutated", syncAccounts);
      window.removeEventListener("amaya:session-changed", syncAccounts);
    };
  }, [netIncomePin.financialHeaders]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isActionMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setIsActionMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsActionMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActionMenuOpen]);

  // Fetch period audit numbers whenever Withdraw modal is open and date range changes
  useEffect(() => {
    if (!isModalOpen || modalType !== "withdraw") return undefined;
    if (withdrawFrom && withdrawTo && withdrawFrom > withdrawTo) {
      return undefined;
    }
    let active = true;
    const params = new URLSearchParams();
    if (withdrawFrom) params.set("from", withdrawFrom);
    if (withdrawTo) params.set("to", withdrawTo);
    const qs = params.toString();

    apiRequest(`/finances/accounts${qs ? `?${qs}` : ""}`, { headers: netIncomePin.financialHeaders })
      .then((res) => {
        if (!active) return;
        const periodSum = res?.summary || null;
        setWithdrawPeriodSummary(periodSum);
        if (!qs) {
          setData(res);
        }
        if (periodSum) {
          const periodConfirmedCash = Number(
            periodSum.confirmedCashDrawer !== undefined
              ? periodSum.confirmedCashDrawer
              : periodSum.cashDrawer || 0,
          );
          const channelBalances = {
            "1010": periodConfirmedCash,
            "1020": Number(periodSum.gcash || 0),
            "1030": Number(periodSum.bank || 0),
            "1040": Number(periodSum.reserve || 0),
          };
          const avail = channelBalances[withdrawChannel] ?? periodConfirmedCash;
          const gross = Number(periodSum.grossProfit || 0);
          const recommended = Math.max(0, Math.min(gross, avail));
          setWithdrawAmount(recommended > 0 ? recommended.toFixed(2) : "");
        }
      })
      .catch((err) => {
        if (!active) return;
        setModalFeedback({
          type: "error",
          text: err?.message || "Failed to load period audit figures.",
        });
      })
      .finally(() => {
        if (active) setWithdrawLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isModalOpen, modalType, withdrawFrom, withdrawTo, withdrawChannel, netIncomePin.financialHeaders]);

  const applyWithdrawPreset = (presetKey) => {
    setWithdrawPreset(presetKey);
    setModalFeedback(null);
    setWithdrawLoading(true);
    if (presetKey === "3days") {
      setWithdrawFrom(getManilaDateOffset(2));
      setWithdrawTo(getManilaDateOffset(0));
    } else if (presetKey === "today") {
      const today = getManilaDateOffset(0);
      setWithdrawFrom(today);
      setWithdrawTo(today);
    } else if (presetKey === "7days") {
      setWithdrawFrom(getManilaDateOffset(6));
      setWithdrawTo(getManilaDateOffset(0));
    } else if (presetKey === "all") {
      setWithdrawFrom("");
      setWithdrawTo("");
    }
  };

  const handleOpenModal = (type = "opening_balance") => {
    setIsActionMenuOpen(false);
    setModalType(type);
    capitalRequestIdRef.current = createClientRequestId(type === "withdraw" ? "wd" : "cap");
    setCashDrawer("");
    setGcash("");
    setBank("");
    setCapitalReserve("");
    setEquipment("");
    setModalFeedback(null);

    if (type === "withdraw") {
      const from3d = getManilaDateOffset(2);
      const toToday = getManilaDateOffset(0);
      setWithdrawPreset("3days");
      setWithdrawFrom(from3d);
      setWithdrawTo(toToday);
      setWithdrawChannel("1010");
      setWithdrawLoading(true);
      setNotes("Owner 3-day audit withdrawal");
    } else {
      setNotes("Store Opening Capital Registration");
    }
    setIsModalOpen(true);
  };

  const handleSwitchModalTab = (nextType) => {
    setModalType(nextType);
    setModalFeedback(null);
    capitalRequestIdRef.current = createClientRequestId(nextType === "withdraw" ? "wd" : "cap");
    if (nextType === "withdraw") {
      setWithdrawLoading(true);
      if (!notes || notes === "Store Opening Capital Registration") {
        setNotes("Owner 3-day audit withdrawal");
      }
    } else if (!notes || notes === "Owner 3-day audit withdrawal") {
      setNotes("Store Opening Capital Registration");
    }
  };

  const summary = data?.summary || {
    totalStoreAssets: 0,
    totalConfirmedMoney: 0,
    cashDrawer: 0,
    unconfirmedCounterCash: 0,
    confirmedCashDrawer: 0,
    unconfirmedOrdersCount: 0,
    unconfirmedSalesTotal: 0,
    gcash: 0,
    bank: 0,
    reserve: 0,
    liveInventoryValue: 0,
    nonCurrentEquipment: 0,
    baseCapitalMoney: 0,
    netProfitAfterSale: 0,
    netSalesRevenue: 0,
    cogs: 0,
    grossProfit: 0,
  };

  const unconfirmedCounterCash = Number(summary.unconfirmedCounterCash || 0);
  const confirmedCashDrawer = Number(
    summary.confirmedCashDrawer !== undefined
      ? summary.confirmedCashDrawer
      : Math.max(0, Number(summary.cashDrawer || 0) - unconfirmedCounterCash),
  );
  const unconfirmedOrdersCount = Number(summary.unconfirmedOrdersCount || 0);

  const activeAuditSummary = withdrawPeriodSummary || summary;
  const periodSales = Number(activeAuditSummary.netSalesRevenue || 0);
  const periodCogs = Number(
    activeAuditSummary.cogs !== undefined
      ? activeAuditSummary.cogs
      : periodSales - Number(activeAuditSummary.grossProfit ?? activeAuditSummary.netProfitAfterSale ?? 0),
  );
  const periodGrossProfit = Number(
    activeAuditSummary.grossProfit !== undefined
      ? activeAuditSummary.grossProfit
      : periodSales - periodCogs,
  );
  const periodOperatingExpenses = Number(activeAuditSummary.totalOperatingExpenses ?? activeAuditSummary.operatingExpenses ?? 0);
  const periodNetIncome = activeAuditSummary.netIncome == null ? null : Number(activeAuditSummary.netIncome);

  const channelBalancesMap = useMemo(() => ({
    "1010": confirmedCashDrawer,
    "1020": Number(summary.gcash || 0),
    "1030": Number(summary.bank || 0),
    "1040": Number(summary.reserve || 0),
  }), [confirmedCashDrawer, summary.bank, summary.gcash, summary.reserve]);
  const selectedChannelBalance = channelBalancesMap[withdrawChannel] ?? 0;

  const handleSubmitCapital = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setModalFeedback(null);

    if (!capitalRequestIdRef.current) {
      capitalRequestIdRef.current = createClientRequestId(modalType === "withdraw" ? "wd" : "cap");
    }
    const clientRequestId = capitalRequestIdRef.current;

    try {
      if (modalType === "opening_balance") {
        await apiRequest("/finances/opening-balance", {
          method: "POST",
          body: JSON.stringify({
            cashDrawer: Number(cashDrawer) || 0,
            gcash: Number(gcash) || 0,
            bank: Number(bank) || 0,
            capitalReserve: Number(capitalReserve) || 0,
            equipment: Number(equipment) || 0,
            notes: notes.trim() || "Initial capital setup",
            clientRequestId,
          }),
        });
        setModalFeedback({ type: "success", text: "Capital recorded successfully into double-entry ledger!" });
      } else if (modalType === "withdraw") {
        if (withdrawFrom && withdrawTo && withdrawFrom > withdrawTo) {
          setModalFeedback({ type: "error", text: "Start date must be on or before end date." });
          setSubmitting(false);
          return;
        }
        const numAmount = Number(withdrawAmount);
        if (!Number.isFinite(numAmount) || numAmount <= 0) {
          setModalFeedback({ type: "error", text: "Please enter a valid withdrawal amount greater than ₱0.00." });
          setSubmitting(false);
          return;
        }
        if (numAmount > selectedChannelBalance) {
          setModalFeedback({
            type: "error",
            text: `Insufficient channel funds: trying to withdraw ${peso(numAmount)}, but selected channel only has ${peso(selectedChannelBalance)}.`,
          });
          setSubmitting(false);
          return;
        }

        await apiRequest("/finances/journal-entries", {
          method: "POST",
          body: JSON.stringify({
            entryType: "owner_withdrawal",
            amount: Number(numAmount.toFixed(2)),
            debitAccountCode: "3020",
            creditAccountCode: withdrawChannel,
            memo: notes.trim() || `Owner audit withdrawal (${withdrawFrom || "all"} to ${withdrawTo || "today"})`,
            clientRequestId,
          }),
        });
        setModalFeedback({
          type: "success",
          text: `Withdrawal of ${peso(numAmount)} recorded into double-entry ledger!`,
        });
      }

      capitalRequestIdRef.current = null;
      await fetchFinancialAccounts();
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      setTimeout(() => {
        setIsModalOpen(false);
        setModalFeedback(null);
      }, 1200);
    } catch (err) {
      setModalFeedback({ type: "error", text: err?.message || "Failed to record financial transaction." });
    } finally {
      setSubmitting(false);
    }
  };

  const totalSales = Number(summary.netSalesRevenue || 0);
  const cogs = Number(summary.cogs !== undefined ? summary.cogs : (totalSales - Number(summary.grossProfit ?? summary.netProfitAfterSale ?? 0)));
  const grossProfit = Number(summary.grossProfit !== undefined ? summary.grossProfit : (totalSales - cogs));
  const isNegativeProfit = grossProfit < 0;

  return (
    <>
      <section className="store-assets-hero-card" aria-label="Amaya Store Total Assets Overview">
        <div className="store-assets-hero-header">
          <div className="store-assets-title-group">
            <div className="store-assets-icon-badge">
              <Wallet size={24} strokeWidth={2} />
            </div>
            <div>
              <h2>Store Total Asset Value</h2>
              <p className="store-assets-subtitle">Owner-confirmed store money (excludes unsold inventory &amp; unconfirmed counter cash)</p>
            </div>
          </div>

          <div className="store-assets-actions">
            <button
              type="button"
              className="btn-financial-action"
              onClick={() => fetchFinancialAccounts()}
              disabled={refreshing}
              title="Refresh financial balances"
              aria-label="Refresh asset balances"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              <span>{refreshing ? "Updating..." : "Refresh"}</span>
            </button>

            <div className="store-assets-action-menu-wrap" ref={actionMenuRef}>
              <button
                type="button"
                className="btn-financial-action btn-financial-primary"
                aria-haspopup="menu"
                aria-expanded={isActionMenuOpen}
                onClick={() => setIsActionMenuOpen((prev) => !prev)}
              >
                <PlusCircle size={14} />
                <span>+ Capital / Withdraw</span>
                <ChevronDown size={14} />
              </button>

              {isActionMenuOpen && (
                <div className="store-assets-dropdown-menu" role="menu" aria-label="Capital and withdrawal options">
                  <button
                    type="button"
                    role="menuitem"
                    className="store-assets-dropdown-item"
                    onClick={() => handleOpenModal("opening_balance")}
                  >
                    <PlusCircle size={15} />
                    <div className="store-assets-dropdown-text">
                      <strong>Register Capital</strong>
                      <small>Add initial or store expansion funds</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="store-assets-dropdown-item"
                    onClick={() => handleOpenModal("withdraw")}
                  >
                    <ArrowDownToLine size={15} />
                    <div className="store-assets-dropdown-text">
                      <strong>Withdraw</strong>
                      <small>3-day audit &amp; owner cash-out</small>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ color: "#ffd2d2", fontSize: "0.85rem", padding: "0.5rem 0" }}>
            <AlertCircle size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            {error}
          </div>
        ) : (
          <>
            <div className="store-assets-main-metric">
              <span className="store-assets-total-amount">
                {loading ? "Calculating..." : peso(summary.totalConfirmedMoney ?? summary.totalLiquidAssets ?? 0)}
              </span>
              <span className="store-assets-tag">
                <CheckCircle2 size={13} />
                Audited Ledger Parity
              </span>
              {!loading && unconfirmedCounterCash > 0 && (
                <div className="store-assets-unconfirmed-callout" role="status">
                  <span>
                    ⏳ {peso(unconfirmedCounterCash)} in Counter awaiting Owner Confirmation ({unconfirmedOrdersCount || 1} order{unconfirmedOrdersCount === 1 ? "" : "s"} — confirm on Cashier to add to Total Money)
                  </span>
                </div>
              )}
              {!loading && (
                <>
                <div className="store-assets-equation-bar" aria-label="Store assets breakdown formula">
                  <div className="store-assets-eq-item">
                    <span className="store-assets-eq-label">Total Sales</span>
                    <strong className="store-assets-eq-val">{peso(totalSales)}</strong>
                  </div>
                  <span className="store-assets-eq-op" aria-hidden="true">−</span>
                  <div className="store-assets-eq-item">
                    <span className="store-assets-eq-label">COGS</span>
                    <strong className="store-assets-eq-val">{peso(cogs)}</strong>
                  </div>
                  <span className="store-assets-eq-op" aria-hidden="true">=</span>
                  <div className={`store-assets-eq-item is-total ${isNegativeProfit ? "is-loss" : "is-profit"}`}>
                    <span className="store-assets-eq-label">Gross Profit</span>
                    <strong className="store-assets-eq-val">{peso(grossProfit)}</strong>
                  </div>
                  <span className="store-assets-eq-op" aria-hidden="true">−</span>
                  <div className="store-assets-eq-item">
                    <span className="store-assets-eq-label">Operating Expenses</span>
                    <strong className="store-assets-eq-val">{peso(summary.totalOperatingExpenses ?? summary.operatingExpenses ?? 0)}</strong>
                  </div>
                  <span className="store-assets-eq-op" aria-hidden="true">−</span>
                  <div className="store-assets-eq-item">
                    <span className="store-assets-eq-label">Depreciation &amp; Income Tax</span>
                    <strong className="store-assets-eq-val">{peso(Number(summary.depreciation || 0) + Number(summary.tax || 0))}</strong>
                  </div>
                  <span className="store-assets-eq-op" aria-hidden="true">=</span>
                  <div className="store-assets-eq-item is-total is-profit">
                    <span className="store-assets-eq-label">Net Income</span>
                    <strong className="store-assets-eq-val">{netIncomePin.unlocked && summary.netIncome != null ? peso(summary.netIncome) : "₱••••••"}</strong>
                  </div>
                </div>
                <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}>
                  {netIncomePin.unlocked ? "🔒 Lock / Hide Net Income" : "🔒 View Net Income"}
                </button>
                {netIncomePin.unlocked && <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Change PIN</button>}
                </>
              )}
            </div>

            <div className="store-assets-chips-grid">
              <div className="store-asset-chip">
                <span className="chip-label">
                  <Coins size={12} />
                  Cash in Counter
                </span>
                <span className="chip-value">{peso(summary.cashDrawer)}</span>
                {unconfirmedCounterCash > 0 && (
                  <span className="chip-subnote is-pending">
                    Pending Owner Confirm: {peso(unconfirmedCounterCash)}
                    {confirmedCashDrawer > 0 ? ` · Confirmed: ${peso(confirmedCashDrawer)}` : ""}
                  </span>
                )}
              </div>

              <div className="store-asset-chip">
                <span className="chip-label">
                  <Smartphone size={12} />
                  GCash Wallet
                </span>
                <span className="chip-value">{peso(summary.gcash)}</span>
              </div>

              <div className="store-asset-chip">
                <span className="chip-label">
                  <Landmark size={12} />
                  Store Bank
                </span>
                <span className="chip-value">{peso(summary.bank)}</span>
              </div>

              <div className="store-asset-chip">
                <span className="chip-label">
                  <PiggyBank size={12} />
                  Owner Reserve
                </span>
                <span className="chip-value">{peso(summary.reserve)}</span>
              </div>

              <div className="store-asset-chip">
                <span className="chip-label">
                  <Package size={12} />
                  Live Inventory
                </span>
                <span className="chip-value">{peso(summary.liveInventoryValue)}</span>
                <span className="chip-subnote">Unsold stock (not in total money)</span>
              </div>

              <div className="store-asset-chip">
                <span className="chip-label">
                  <Coffee size={12} />
                  Equipment
                </span>
                <span className="chip-value">{peso(summary.nonCurrentEquipment)}</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Capital Registration & Owner Audit Withdrawal Modal */}
      {isModalOpen && (
        <div className="fin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fin-modal-title">
          <div className="fin-modal-box">
            <div className="fin-modal-header">
              <h3 id="fin-modal-title">
                {modalType === "withdraw"
                  ? "Withdraw Store Proceeds (Audit & Payout)"
                  : "Register Initial Business Capital"}
              </h3>
              <button
                type="button"
                className="fin-modal-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitCapital}>
              <div className="fin-modal-body">
                <div className="store-assets-modal-tabs" role="tablist" aria-label="Transaction mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={modalType === "opening_balance"}
                    className={`store-assets-modal-tab ${modalType === "opening_balance" ? "is-active" : ""}`}
                    onClick={() => handleSwitchModalTab("opening_balance")}
                  >
                    <PlusCircle size={14} />
                    <span>Register Capital</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={modalType === "withdraw"}
                    className={`store-assets-modal-tab ${modalType === "withdraw" ? "is-active" : ""}`}
                    onClick={() => handleSwitchModalTab("withdraw")}
                  >
                    <ArrowDownToLine size={14} />
                    <span>Withdraw</span>
                  </button>
                </div>

                {modalFeedback && (
                  <div
                    style={{
                      padding: "0.6rem 0.85rem",
                      borderRadius: "8px",
                      fontSize: "0.85rem",
                      background: modalFeedback.type === "success" ? "#eef8f2" : "#fdf2f2",
                      color: modalFeedback.type === "success" ? "#1e7047" : "#c53030",
                      border: `1px solid ${modalFeedback.type === "success" ? "#c6ebd5" : "#fed7d7"}`,
                    }}
                  >
                    {modalFeedback.text}
                  </div>
                )}

                {modalType === "withdraw" ? (
                  <>
                    <div className="fin-form-group">
                      <label>
                        <Calendar size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
                        Audit Schedule Preset
                      </label>
                      <div className="fin-preset-row">
                        <button
                          type="button"
                          className={`fin-preset-chip ${withdrawPreset === "3days" ? "is-active" : ""}`}
                          onClick={() => applyWithdrawPreset("3days")}
                        >
                          Every 3 Days
                        </button>
                        <button
                          type="button"
                          className={`fin-preset-chip ${withdrawPreset === "today" ? "is-active" : ""}`}
                          onClick={() => applyWithdrawPreset("today")}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          className={`fin-preset-chip ${withdrawPreset === "7days" ? "is-active" : ""}`}
                          onClick={() => applyWithdrawPreset("7days")}
                        >
                          7 Days
                        </button>
                        <button
                          type="button"
                          className={`fin-preset-chip ${withdrawPreset === "all" ? "is-active" : ""}`}
                          onClick={() => applyWithdrawPreset("all")}
                        >
                          All Sessions
                        </button>
                      </div>
                    </div>

                    <div className="fin-two-col">
                      <div className="fin-form-group">
                        <label htmlFor="fin-withdraw-from">From Date</label>
                        <input
                          id="fin-withdraw-from"
                          type="date"
                          className="fin-form-input"
                          value={withdrawFrom}
                          onChange={(e) => {
                            setWithdrawPreset("custom");
                            setWithdrawFrom(e.target.value);
                          }}
                        />
                      </div>
                      <div className="fin-form-group">
                        <label htmlFor="fin-withdraw-to">To Date</label>
                        <input
                          id="fin-withdraw-to"
                          type="date"
                          className="fin-form-input"
                          value={withdrawTo}
                          onChange={(e) => {
                            setWithdrawPreset("custom");
                            setWithdrawTo(e.target.value);
                          }}
                        />
                      </div>
                    </div>

                    <div className="store-audit-payout-card" aria-live="polite">
                      <div className="store-audit-payout-header">
                        <strong>Store Audit &amp; Payout Summary</strong>
                        <span>
                          {withdrawLoading
                            ? "Syncing period..."
                            : withdrawFrom || withdrawTo
                              ? `${withdrawFrom || "Start"} → ${withdrawTo || "Today"}`
                              : "All-Time Ledger"}
                        </span>
                      </div>
                      <div className="store-audit-payout-row">
                        <span>Total Sales (Selected Dates)</span>
                        <strong>{peso(periodSales)}</strong>
                      </div>
                      <div className="store-audit-payout-row is-cogs">
                        <span>Less COGS (Keep for Stock Refill)</span>
                        <strong>− {peso(periodCogs)}</strong>
                      </div>
                      <div className="store-audit-payout-row is-gross">
                        <span>Gross Profit (Recommended to Withdraw)</span>
                        <strong>{peso(periodGrossProfit)}</strong>
                      </div>
                      <div className="store-audit-payout-row">
                        <span>Less Operating Expenses</span>
                        <strong>− {peso(periodOperatingExpenses)}</strong>
                      </div>
                      <div className="store-audit-payout-row is-net-income">
                        <span>Net Income</span>
                        <strong>{netIncomePin.unlocked && periodNetIncome != null ? peso(periodNetIncome) : "₱••••••"}</strong>
                      </div>
                      <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}>
                        {netIncomePin.unlocked ? "🔒 Lock / Hide Net Income" : "🔒 View Net Income"}
                      </button>
                      {netIncomePin.unlocked && <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Change PIN</button>}
                      <div className="store-audit-payout-row is-available">
                        <span>Available Cash in Selected Channel</span>
                        <strong>{peso(selectedChannelBalance)}</strong>
                      </div>
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-withdraw-channel">Withdraw From Channel</label>
                      <select
                        id="fin-withdraw-channel"
                        className="fin-form-input"
                        value={withdrawChannel}
                        onChange={(e) => setWithdrawChannel(e.target.value)}
                      >
                        <option value="1010">Cash in Counter ({peso(summary.cashDrawer)})</option>
                        <option value="1020">GCash Wallet ({peso(summary.gcash)})</option>
                        <option value="1030">Store Bank ({peso(summary.bank)})</option>
                        <option value="1040">Owner Reserve ({peso(summary.reserve)})</option>
                      </select>
                    </div>

                    <div className="fin-form-group">
                      <label>Quick Payout Fill</label>
                      <div className="fin-preset-row">
                        <button
                          type="button"
                          className="fin-preset-chip"
                          onClick={() => setWithdrawAmount(Math.max(0, periodGrossProfit).toFixed(2))}
                        >
                          Take Gross Profit ({peso(Math.max(0, periodGrossProfit))})
                        </button>
                        <button
                          type="button"
                          className="fin-preset-chip"
                          onClick={() => setWithdrawAmount(Math.max(0, periodSales).toFixed(2))}
                        >
                          Take Total Sales ({peso(Math.max(0, periodSales))})
                        </button>
                        <button
                          type="button"
                          className="fin-preset-chip"
                          onClick={() => setWithdrawAmount(Math.max(0, selectedChannelBalance).toFixed(2))}
                        >
                          Take Max Available ({peso(Math.max(0, selectedChannelBalance))})
                        </button>
                      </div>
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-withdraw-amount">Amount to Withdraw (₱)</label>
                      <input
                        id="fin-withdraw-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        className="fin-form-input fin-input-tabular"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-withdraw-notes">Audit / Withdrawal Note</label>
                      <input
                        id="fin-withdraw-notes"
                        type="text"
                        maxLength={255}
                        placeholder="e.g. Owner 3-day audit withdrawal"
                        className="fin-form-input"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: "0.82rem", color: "#634b35", margin: 0 }}>
                      Enter the opening capital amounts allocated across store channels. All debits are automatically
                      balanced against <strong>3010 Owner&apos;s Capital</strong>.
                    </p>

                    <div className="fin-form-group">
                      <label htmlFor="fin-cash-drawer">Cash on Hand / Counter Drawer (₱)</label>
                      <input
                        id="fin-cash-drawer"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="fin-form-input"
                        value={cashDrawer}
                        onChange={(e) => setCashDrawer(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-gcash">GCash Wallet Balance (₱)</label>
                      <input
                        id="fin-gcash"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="fin-form-input"
                        value={gcash}
                        onChange={(e) => setGcash(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-bank">Store Bank Balance (₱)</label>
                      <input
                        id="fin-bank"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="fin-form-input"
                        value={bank}
                        onChange={(e) => setBank(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-reserve">Owner Capital Reserve (₱)</label>
                      <input
                        id="fin-reserve"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="fin-form-input"
                        value={capitalReserve}
                        onChange={(e) => setCapitalReserve(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-equipment">Kitchen &amp; Espresso Equipment Valuation (₱)</label>
                      <input
                        id="fin-equipment"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="fin-form-input"
                        value={equipment}
                        onChange={(e) => setEquipment(e.target.value)}
                      />
                    </div>

                    <div className="fin-form-group">
                      <label htmlFor="fin-notes">Audit Memo / Description</label>
                      <input
                        id="fin-notes"
                        type="text"
                        maxLength={255}
                        placeholder="e.g. Initial store capital contribution"
                        className="fin-form-input"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="fin-modal-footer">
                <button
                  type="button"
                  className="fin-modal-btn-secondary"
                  onClick={() => {
                    capitalRequestIdRef.current = null;
                    setIsModalOpen(false);
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fin-modal-btn-primary"
                  disabled={submitting}
                >
                  {submitting
                    ? "Posting Ledger..."
                    : modalType === "withdraw"
                      ? "Confirm Withdrawal"
                      : "Confirm & Post Double Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <NetIncomePinModal
        open={netIncomePin.modalOpen}
        hasPin={netIncomePin.hasPin}
        onClose={() => netIncomePin.setModalOpen(false)}
        onUnlocked={(accessToken) => netIncomePin.unlock(accessToken)}
      />
    </>
  );
}
