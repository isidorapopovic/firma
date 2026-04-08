// src/routes/invoices.js
const express = require('express');
const router = express.Router();
const { query } = require('../db/index');
const { body, validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// Auto-generate invoice number: INV-YYYYMMDD-XXXX
async function generateInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await query(
    `SELECT COUNT(*) FROM invoices WHERE invoice_number LIKE $1`,
    [`INV-${date}-%`]
  );
  const seq = String(parseInt(result.rows[0].count) + 1).padStart(4, '0');
  return `INV-${date}-${seq}`;
}

// ── GET /api/invoices ─────────────────────────────────────────────────────
// ?status=unpaid|overdue|paid|draft|partial|cancelled|disputed
// ?overdue=true
// ?client=name (partial match)
router.get('/', async (req, res) => {
  try {
    await query('SELECT refresh_overdue_statuses()');

    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.overdue === 'true') {
      conditions.push(`status NOT IN ('paid','cancelled') AND due_date < CURRENT_DATE`);
    } else if (req.query.status) {
      conditions.push(`status = $${i++}`);
      params.push(req.query.status);
    }

    if (req.query.client) {
      conditions.push(`client_name ILIKE $${i++}`);
      params.push(`%${req.query.client}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT *, (total_amount - amount_paid) AS balance_due,
              CASE WHEN due_date < CURRENT_DATE AND status NOT IN ('paid','cancelled')
                   THEN CURRENT_DATE - due_date ELSE 0 END AS days_overdue
       FROM invoices ${where}
       ORDER BY due_date ASC`,
      params
    );
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices/overdue ─────────────────────────────────────────────
router.get('/overdue', async (req, res) => {
  try {
    await query('SELECT refresh_overdue_statuses()');
    const result = await query(`
      SELECT *, (total_amount - amount_paid) AS balance_due,
             (CURRENT_DATE - due_date) AS days_overdue
      FROM overdue_invoices`
    );
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices/summary ─────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'unpaid')   AS unpaid_count,
        COUNT(*) FILTER (WHERE status = 'overdue')  AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'paid')     AS paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'unpaid'),  0) AS unpaid_total,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'overdue'), 0) AS overdue_total,
        COALESCE(SUM(amount_paid),                                    0) AS total_collected
      FROM invoices`
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/invoices/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT *, (total_amount - amount_paid) AS balance_due FROM invoices WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/invoices ────────────────────────────────────────────────────
router.post('/',
  [
    body('client_name').notEmpty().trim(),
    body('amount').isFloat({ gt: 0 }),
    body('due_date').isISO8601(),
  ],
  validate,
  async (req, res) => {
    const {
      client_name, client_email, description, amount,
      tax_amount = 0, currency = 'USD', issue_date, due_date, notes
    } = req.body;

    try {
      const invoice_number = req.body.invoice_number || await generateInvoiceNumber();
      const result = await query(
        `INSERT INTO invoices
           (invoice_number, client_name, client_email, description, amount,
            tax_amount, currency, issue_date, due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [invoice_number, client_name, client_email, description, amount,
         tax_amount, currency, issue_date || new Date().toISOString().slice(0,10),
         due_date, notes]
      );
      res.status(201).json({ data: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Invoice number already exists' });
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PATCH /api/invoices/:id/pay ───────────────────────────────────────────
// Record a payment (partial or full)
router.patch('/:id/pay', async (req, res) => {
  const { payment_amount } = req.body;
  if (!payment_amount || isNaN(payment_amount)) {
    return res.status(400).json({ error: 'payment_amount required' });
  }
  try {
    // Get current invoice
    const inv = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Not found' });

    const invoice = inv.rows[0];
    const newAmountPaid = parseFloat(invoice.amount_paid) + parseFloat(payment_amount);
    const isPaidInFull = newAmountPaid >= parseFloat(invoice.total_amount);

    const result = await query(
      `UPDATE invoices
       SET amount_paid = $1,
           status = $2,
           paid_date = CASE WHEN $2 = 'paid' THEN CURRENT_DATE ELSE paid_date END
       WHERE id = $3 RETURNING *`,
      [
        newAmountPaid,
        isPaidInFull ? 'paid' : 'partial',
        req.params.id
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const fields = ['client_name','client_email','description','amount','tax_amount',
                  'currency','issue_date','due_date','paid_date','status','amount_paid','notes'];
  const updates = [];
  const params = [];
  let i = 1;

  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${i++}`);
      params.push(req.body[f]);
    }
  });

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);

  try {
    const result = await query(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM invoices WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
