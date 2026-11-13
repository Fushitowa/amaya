import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import "../assets/css/admin/FinancialManagement.css";

function peso(val) {
  const num = Number(val || 0);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function StoreAssetsHeroCard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Capital Injection / Opening Balance Modal Form state
  const [modalType, setModalType] = useState("opening_balance"); // 'opening_balance' or 'capital_injection'
  const [cashDrawer, setCashDrawer] = useState("");
  const [gcash, setGcash] = useState("");
  const [bank, setBank] = useState("");
  const [capitalReserve, setCapitalReserve] = useState("");
  const [equipment, setEquipment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);

  const fetchFinancialAccounts = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const res = await apiRequest("/finances/accounts");
      setData(res);
    } catch (err) {
      console.error("Failed to load store asset accounts:", err);
      setError(err?.message || "Could not retrieve store financial balances.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const syncAccounts = () => {
      apiRequest("/finances/accounts")
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
  }, []);

  const handleOpenModal = (type = "opening_balance") => {
    setModalType(type);
    setCashDrawer("");
    setGcash("");
    setBank("");
    setCapitalReserve("");
    setEquipment("");
    setNotes(type === "opening_balance" ? "Store Opening Capital Registration" : "Owner Capital Injection");
    setModalFeedback(null);
    setIsModalOpen(true);
  };

  const handleSubmitCapital = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setModalFeedback(null);

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
          }),
        });
      } else {
        const numAmount = Number(cashDrawer || gcash || bank || capitalReserve || 0);
        const targetAcc = cashDrawer ? "1010" : gcash ? "1020" : bank ? "1030" : "1040";
        await apiRequest("/finances/journal-entries", {
          method: "POST",
          body: JSON.stringify({
            entryType: "capital_injection",
            amount: numAmount,
            debitAccountCode: targetAcc,
            creditAccountCode: "3010",
            memo: notes.trim() || "Owner capital injection",
          }),
        });
      }

      setModalFeedback({ type: "success", text: "Capital recorded successfully into double-entry ledger!" });
      await fetchFinancialAccounts();
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

  const summary = data?.summary || {
    totalStoreAssets: 0,
    cashDrawer: 0,
    gcash: 0,
    bank: 0,
    reserve: 0,
    liveInventoryValue: 0,
    nonCurrentEquipment: 0,
  };

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
              <p className="store-assets-subtitle">Live double-entry verified assets & dynamic stock reserves</p>
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

            <button
              type="button"
              className="btn-financial-action btn-financial-primary"
              onClick={() => handleOpenModal("opening_balance")}
            >
              <PlusCircle size={14} />
              <span>Register / Add Capital</span>
            </button>
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
                {loading ? "Calculating..." : peso(summary.totalStoreAssets)}
              </span>
              <span className="store-assets-tag">
                <CheckCircle2 size={13} />
                Audited Ledger Parity
              </span>
            </div>

            <div className="store-assets-chips-grid">
              <div className="store-asset-chip">
                <span className="chip-label">
                  <Coins size={12} />
                  Cash in Counter
                </span>
                <span className="chip-value">{peso(summary.cashDrawer)}</span>
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

      {/* Capital Registration Modal */}
      {isModalOpen && (
        <div className="fin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fin-modal-title">
          <div className="fin-modal-box">
            <div className="fin-modal-header">
              <h3 id="fin-modal-title">
                {modalType === "opening_balance" ? "Register Initial Business Capital" : "Inject Capital Funds"}
              </h3>
              <button
                type="button"
                className="btn-financial-action"
                style={{ padding: "4px 8px" }}
                onClick={() => setIsModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitCapital}>
              <div className="fin-modal-body">
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

                <p style={{ fontSize: "0.82rem", color: "#634b35", margin: 0 }}>
                  Enter the opening capital amounts allocated across store channels. All debits are automatically
                  balanced against <strong>3010 Owner's Capital</strong>.
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
                  <label htmlFor="fin-equipment">Kitchen & Espresso Equipment Valuation (₱)</label>
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
              </div>

              <div className="fin-modal-footer">
                <button
                  type="button"
                  className="btn-financial-action"
                  style={{ color: "#4a2c11", background: "#f0e9df", border: "1px solid #d6c7b8" }}
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-financial-action btn-financial-primary"
                  disabled={submitting}
                >
                  {submitting ? "Posting Ledger..." : "Confirm & Post Double Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
