-- ============================================================
-- FIRMA - Full Database Schema
-- Neon / PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Shared trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RECURRING TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE,
    next_due_date DATE NOT NULL,
    last_processed_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    category VARCHAR(100),
    tags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_recurring_transactions_updated_at ON recurring_transactions;
CREATE TRIGGER trg_recurring_transactions_updated_at
BEFORE UPDATE ON recurring_transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_recurring_next_due
    ON recurring_transactions(next_due_date, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_seed
    ON recurring_transactions(name, amount, type, frequency, start_date);

-- ============================================================
-- BILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'unpaid', 'cancelled', 'overdue')),
    category VARCHAR(100),
    vendor VARCHAR(255),
    recurring_transaction_id UUID REFERENCES recurring_transactions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_bills_updated_at ON bills;
CREATE TRIGGER trg_bills_updated_at
BEFORE UPDATE ON bills
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_bills_due_date
    ON bills(due_date, status);

CREATE INDEX IF NOT EXISTS idx_bills_status
    ON bills(status);

CREATE INDEX IF NOT EXISTS idx_bills_recurring_transaction_id
    ON bills(recurring_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_seed
    ON bills(name, amount, due_date, vendor);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled', 'disputed', 'sent')),
    amount_paid NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_invoices_status
    ON invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoices_due_date
    ON invoices(due_date, status);

CREATE INDEX IF NOT EXISTS idx_invoices_client
    ON invoices(client_name);

-- ============================================================
-- CSV IMPORT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS csv_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('recurring_transactions', 'bills', 'invoices')),
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_failed INTEGER NOT NULL DEFAULT 0,
    errors JSONB,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Views
-- ============================================================
CREATE OR REPLACE VIEW overdue_invoices AS
SELECT *
FROM invoices
WHERE status NOT IN ('paid', 'cancelled')
  AND due_date < CURRENT_DATE
ORDER BY due_date ASC;

CREATE OR REPLACE VIEW upcoming_bills_view AS
SELECT *
FROM bills
WHERE status IN ('pending', 'unpaid', 'overdue')
  AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY due_date ASC;

-- ============================================================
-- Function: refresh overdue statuses
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_overdue_statuses()
RETURNS void AS $$
BEGIN
    UPDATE bills
    SET status = 'overdue'
    WHERE status IN ('pending', 'unpaid')
      AND due_date < CURRENT_DATE;

    UPDATE invoices
    SET status = 'overdue'
    WHERE status IN ('unpaid', 'partial', 'sent')
      AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Seed data
-- ============================================================

INSERT INTO recurring_transactions
(name, description, amount, currency, type, frequency, start_date, end_date, next_due_date, category, tags)
VALUES
('Office Rent', 'Monthly office lease payment', 1200.00, 'USD', 'expense', 'monthly', '2026-01-01', NULL, '2026-01-01', 'Rent', ARRAY['office','lease']),
('Software Subscriptions', 'Team software licences and SaaS subscriptions', 245.00, 'USD', 'expense', 'monthly', '2026-01-05', NULL, '2026-01-05', 'Software', ARRAY['saas','tools']),
('Client Maintenance Contract', 'Recurring maintenance income from retained client', 1800.00, 'USD', 'income', 'monthly', '2026-01-15', NULL, '2026-01-15', 'Revenue', ARRAY['client','retainer'])
ON CONFLICT DO NOTHING;

INSERT INTO bills
(name, description, amount, currency, due_date, paid_date, status, category, vendor, notes)
VALUES
('Electricity Bill', 'March electricity bill', 210.00, 'USD', '2026-04-15', NULL, 'unpaid', 'Utilities', 'Electricity Board', 'Office power usage'),
('Adobe Creative Cloud', 'Creative Cloud team plan', 96.00, 'USD', '2026-04-20', NULL, 'unpaid', 'Software', 'Adobe', 'Monthly design subscription')
ON CONFLICT DO NOTHING;

INSERT INTO invoices
(invoice_number, client_name, client_email, description, amount, tax_amount, currency, issue_date, due_date, paid_date, status, amount_paid, notes)
VALUES
('INV-2026-001', 'Nova Retail', 'billing@novaretail.com', 'Website support and monthly maintenance', 2400.00, 0.00, 'USD', '2026-04-01', '2026-04-14', NULL, 'unpaid', 0.00, 'Net 14 invoice'),
('INV-2026-002', 'BluePeak Studio', 'accounts@bluepeakstudio.com', 'Brand asset production and revisions', 1350.00, 0.00, 'USD', '2026-03-28', '2026-04-11', NULL, 'overdue', 0.00, 'Follow-up reminder required')
ON CONFLICT (invoice_number) DO NOTHING;