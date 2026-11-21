import { useEffect } from "react";
import { Printer, X } from "lucide-react";

const BASIS = { monthly: "Monthly", daily: "Daily", hourly: "Hourly" };
const PER = { monthly: "month", daily: "day", hourly: "hour" };
const CHANNEL = { cash_counter: "Cash", gcash: "GCash", store_bank: "Bank transfer" };

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceDate(value) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Itemized payslip (DOLE: rate, days/hours, overtime, each deduction, net pay).
 * `printing` adds a class to <body> so only the payslip prints.
 */
export default function PayslipView({ run, line, businessName = "Amaya", onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const print = () => {
    document.body.classList.add("printing-payslip");
    const done = () => {
      document.body.classList.remove("printing-payslip");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const deductions = [
    ["SSS (employee share)", line.sssEe],
    ["PhilHealth (employee share)", line.philhealthEe],
    ["Pag-IBIG (employee share)", line.pagibigEe],
    ["Withholding tax", line.withholdingTax],
  ];
  const totalDeductions = deductions.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const timeLabel = line.payBasis === "monthly"
    ? `${line.daysAbsent ? `${line.daysAbsent} day(s) absent` : "Full cut-off"}`
    : line.payBasis === "daily" ? `${line.daysWorked} day(s) worked` : `${line.hoursWorked} hour(s) worked`;

  return (
    <div className="sr-overlay payslip-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sr-modal is-wide payslip-modal" role="dialog" aria-modal="true" aria-label={`Payslip for ${line.employeeName}`}>
        <header className="sr-modal-head payslip-no-print">
          <h3>Payslip</h3>
          <div className="payslip-head-actions">
            <button type="button" className="ec-btn ec-btn-solid" onClick={print}><Printer size={14} aria-hidden="true" /> Print</button>
            <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        </header>
        <article className="payslip" id="payslip-print">
          <header className="payslip-top">
            <div>
              <strong className="payslip-biz">{businessName}</strong>
              <span>PAYSLIP</span>
            </div>
            <dl>
              <div><dt>Pay period</dt><dd>{niceDate(run.periodStart)} – {niceDate(run.periodEnd)}</dd></div>
              <div><dt>Pay date</dt><dd>{niceDate(run.payDate)}</dd></div>
            </dl>
          </header>
          <section className="payslip-who">
            <div><span>Employee</span><strong>{line.employeeName}</strong></div>
            <div><span>Position</span><strong>{line.position}</strong></div>
            <div><span>Pay basis</span><strong>{BASIS[line.payBasis]} — {peso(line.rate)} per {PER[line.payBasis]}</strong></div>
            <div><span>Time</span><strong>{timeLabel}{line.otHours ? ` · ${line.otHours} OT hour(s)` : ""}</strong></div>
          </section>
          <div className="payslip-cols">
            <table>
              <caption>Earnings</caption>
              <tbody>
                <tr><td>Basic pay{line.prorationNote ? <small>{line.prorationNote}</small> : null}</td><td>{peso(line.basicPay)}</td></tr>
                <tr><td>Overtime (+25%)</td><td>{peso(line.otPay)}</td></tr>
              </tbody>
              <tfoot><tr><td>Gross pay</td><td>{peso(line.grossPay)}</td></tr></tfoot>
            </table>
            <table>
              <caption>Deductions</caption>
              <tbody>
                {deductions.map(([label, value]) => <tr key={label}><td>{label}</td><td>{peso(value)}</td></tr>)}
              </tbody>
              <tfoot><tr><td>Total deductions</td><td>{peso(totalDeductions)}</td></tr></tfoot>
            </table>
          </div>
          <div className="payslip-net">
            <span>Net pay</span>
            <strong>{peso(line.netPay)}</strong>
          </div>
          <footer className="payslip-foot">
            <p>Employer also paid for you: SSS {peso(line.sssEr + line.ecEr)} (incl. EC), PhilHealth {peso(line.philhealthEr)}, Pag-IBIG {peso(line.pagibigEr)}. 13th month earned this cut-off: {peso(line.thirteenthMonthAccrual)}.</p>
            <p>{line.paidAt ? `Paid by ${CHANNEL[line.paymentChannel] || "—"}.` : "Not yet paid."}</p>
            <div className="payslip-sign"><span>Received by</span><span>Date</span></div>
          </footer>
        </article>
      </div>
    </div>
  );
}
