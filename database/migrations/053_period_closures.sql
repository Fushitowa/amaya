-- Migration 053: Month close (period lock).
-- Once an owner closes a past month, nothing new may be dated inside it, so reports already
-- given to an accountant or owner for that month keep their numbers. Corrections are posted
-- in the current (open) month as a linked reversal plus a new entry.
-- One row per month ever closed. A month is locked while reopened_at IS NULL; reopening keeps
-- the row (who, when, why) and closing it again clears reopened_at.
CREATE TABLE IF NOT EXISTS period_closures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  period_month CHAR(7) NOT NULL,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  close_note VARCHAR(255) NULL,
  reopened_by BIGINT UNSIGNED NULL,
  reopened_at DATETIME NULL,
  reopen_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_period_closures_month (period_month),
  CONSTRAINT fk_period_closures_closed_by FOREIGN KEY (closed_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_period_closures_reopened_by FOREIGN KEY (reopened_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
