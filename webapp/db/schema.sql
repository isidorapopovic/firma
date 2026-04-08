-- ============================================================
-- FIRMA - Full Database Schema
-- Features: Recurring Transactions, Upcoming Bills,
--           Overdue Invoices, CSV Import/Export
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- RECURRING TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE,                          -- NULL = runs forever
    next_due_date DATE NOT NULL,
    last_processed_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    category VARCHAR(100),
    tags TEXT[],                            -- array of string tags
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recurring_transactions_updated_at
BEFORE UPDATE ON recurring_transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for querying upcoming/due
CREATE INDEX idx_recurring_next_due ON recurring_transactions(next_due_date, is_active);


-- ============================================================
-- UPCOMING BILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled', 'overdue')),
    category VARCHAR(100),
    vendor VARCHAR(255),
    recurring_transaction_id UUID REFERENCES recurring_transactions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_bills_updated_at
BEFORE UPDATE ON bills
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-mark overdue bills via a function (call on cron or on read)
CREATE INDEX idx_bills_due_date ON bills(due_date, status);
CREATE INDEX idx_bills_status ON bills(status);


-- ============================================================
-- INVOICES (Overdue / Unpaid)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled', 'disputed')),
    amount_paid NUMERIC(15, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date, status);
CREATE INDEX idx_invoices_client ON invoices(client_name);

-- View: all overdue (due_date passed and not paid/cancelled)
CREATE OR REPLACE VIEW overdue_invoices AS
SELECT * FROM invoices
WHERE status NOT IN ('paid', 'cancelled')
  AND due_date < CURRENT_DATE
ORDER BY due_date ASC;

-- View: upcoming bills (next 30 days, pending)
CREATE OR REPLACE VIEW upcoming_bills_view AS
SELECT * FROM bills
WHERE status = 'pending'
  AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY due_date ASC;


-- ============================================================
-- CSV IMPORT LOG (audit trail for imports)
-- ============================================================
CREATE TABLE IF NOT EXISTS csv_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('recurring_transactions', 'bills', 'invoices')),
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_failed INTEGER NOT NULL DEFAULT 0,
    errors JSONB,                           -- array of {row, error} objects
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FUNCTION: refresh overdue statuses
-- Call this on app startup or via a daily cron job
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_overdue_statuses()
RETURNS void AS $$
BEGIN
    -- Mark bills as overdue
    UPDATE bills
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE;

    -- Mark invoices as overdue
    UPDATE invoices
    SET status = 'overdue'
    WHERE status IN ('unpaid', 'partial')
      AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;
