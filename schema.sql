-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROPERTIES & HOMEOWNERS
CREATE TABLE homeowners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(50) UNIQUE NOT NULL,
    homeowner_id UUID REFERENCES homeowners(id) ON DELETE SET NULL,
    block_number VARCHAR(20) NOT NULL,
    lot_number VARCHAR(20) NOT NULL,
    street_address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. FINANCIAL TRANSACTIONS & LEDGER
CREATE TYPE transaction_type AS ENUM ('DUE_ASSESSMENT', 'PAYMENT', 'LATE_FEE', 'SPECIAL_ASSESSMENT');

CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    line_item_category VARCHAR(100) NOT NULL, -- e.g., 'Monthly Dues', 'Pool Fee', 'Late Fee'
    description TEXT,
    amount NUMERIC(12, 2) NOT NULL, -- Positive for charges, Negative for payments/credits
    balance_after NUMERIC(12, 2) NOT NULL,
    due_date DATE,
    transaction_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. MAINTENANCE LOGS
CREATE TYPE maintenance_status AS ENUM ('Open', 'In-Progress', 'Closed');

CREATE TABLE maintenance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status maintenance_status NOT NULL DEFAULT 'Open',
    cost NUMERIC(12, 2) DEFAULT 0.00,
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_date TIMESTAMPTZ
);

-- 4. COMPLIANCE VIOLATIONS
CREATE TYPE violation_status AS ENUM ('Open', 'Fined', 'Resolved');

CREATE TABLE compliance_violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    violation_id VARCHAR(50) UNIQUE NOT NULL,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    rule_broken TEXT NOT NULL,
    fine_amount NUMERIC(12, 2) DEFAULT 0.00,
    status violation_status NOT NULL DEFAULT 'Open',
    date_issued DATE NOT NULL DEFAULT CURRENT_DATE,
    date_resolved DATE
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX idx_transactions_property ON financial_transactions(property_id);
CREATE INDEX idx_transactions_due_date ON financial_transactions(due_date) WHERE balance_after > 0;
CREATE INDEX idx_maintenance_status ON maintenance_logs(status);
CREATE INDEX idx_violations_status ON compliance_violations(status);