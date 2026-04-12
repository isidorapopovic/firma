export const seedTransactions = [
    {
        id: "TX-10001",
        date: "2026-02-26",
        description: "Website project invoice",
        category: "Sales",
        type: "income",
        amount: 4200
    },
    {
        id: "TX-10002",
        date: "2026-02-24",
        description: "Office supplies",
        category: "Operations",
        type: "expense",
        amount: 180.5
    },
    {
        id: "TX-10003",
        date: "2026-02-22",
        description: "Workspace subscription",
        category: "Software",
        type: "expense",
        amount: 79.99
    },
    {
        id: "TX-10004",
        date: "2026-02-20",
        description: "Monthly consulting",
        category: "Services",
        type: "income",
        amount: 6150
    },
    {
        id: "TX-10005",
        date: "2026-02-18",
        description: "Payroll",
        category: "Staff",
        type: "expense",
        amount: 3200
    },
    {
        id: "TX-10006",
        date: "2026-02-15",
        description: "Office rent",
        category: "Operations",
        type: "expense",
        amount: 1250
    },
    {
        id: "TX-10007",
        date: "2026-02-12",
        description: "Branding work",
        category: "Sales",
        type: "income",
        amount: 2800
    },
    {
        id: "TX-10008",
        date: "2026-02-10",
        description: "VAT refund",
        category: "Tax",
        type: "income",
        amount: 540
    },
    {
        id: "TX-10009",
        date: "2026-04-01",
        description: "Office rent",
        category: "Rent",
        type: "expense",
        amount: 900,
        recurring: true,
        recurringFrequency: "monthly",
        recurringNextDate: "2026-05-01"
    },
    {
        id: "TX-10010",
        date: "2026-04-03",
        description: "Client retainer",
        category: "Sales",
        type: "income",
        amount: 2500,
        recurring: true,
        recurringFrequency: "monthly",
        recurringNextDate: "2026-05-03"
    }
];

export const seedAutomations = [
    {
        id: "AUTO-001",
        name: "Monthly invoice reminder",
        schedule: "Every 1st day at 10:00",
        enabled: true
    },
    {
        id: "AUTO-002",
        name: "Weekly KPI email",
        schedule: "Every Monday at 08:00",
        enabled: true
    },
    {
        id: "AUTO-003",
        name: "Overdue payment follow-up",
        schedule: "Every day at 09:00",
        enabled: false
    }
];



const pool = require('./pool');

async function seed() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Customers
        const customersResult = await client.query(`
      insert into customers (name, email, phone, credit_limit)
      values
        ('Delta Foods', 'ops@deltafoods.rs', '+38160000001', 5000),
        ('Nova Market', 'buying@novamarket.rs', '+38160000002', 3000),
        ('Fresh Trade', 'accounts@freshtrade.rs', '+38160000003', 7000)
      on conflict do nothing
      returning id, name
    `);

        const allCustomers = await client.query(`
      select id, name from customers
      where name in ('Delta Foods', 'Nova Market', 'Fresh Trade')
    `);

        const customerMap = Object.fromEntries(
            allCustomers.rows.map((c) => [c.name, c.id])
        );

        // Products
        await client.query(`
      insert into products (sku_code, name, category, supplier, reorder_point)
      values
        ('SKU-001', 'Mineral Water 1.5L', 'Beverages', 'Aqua Supply', 40),
        ('SKU-002', 'Sparkling Juice 330ml', 'Beverages', 'Fruit Co', 30),
        ('SKU-003', 'Paper Towels 6-pack', 'Household', 'Clean Goods', 20),
        ('SKU-004', 'Dish Soap 500ml', 'Cleaning', 'Clean Goods', 25),
        ('SKU-005', 'Olive Oil 1L', 'Food', 'Mediterranean Imports', 15)
      on conflict (sku_code) do nothing
    `);

        const allProducts = await client.query(`
      select id, sku_code from products
      where sku_code in ('SKU-001', 'SKU-002', 'SKU-003', 'SKU-004', 'SKU-005')
    `);

        const productMap = Object.fromEntries(
            allProducts.rows.map((p) => [p.sku_code, p.id])
        );

        // Inventory
        await client.query(`
      insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
      values
        ($1, 50, 20, now() - interval '2 days'),
        ($2, 20, 25, now() - interval '35 days'),
        ($3, 0, 0, now() - interval '70 days'),
        ($4, 18, 5, now() - interval '10 days'),
        ($5, 12, 2, now() - interval '95 days')
      on conflict (product_id) do update
      set
        current_stock = excluded.current_stock,
        allocated_stock = excluded.allocated_stock,
        last_movement_at = excluded.last_movement_at
    `, [
            productMap['SKU-001'],
            productMap['SKU-002'],
            productMap['SKU-003'],
            productMap['SKU-004'],
            productMap['SKU-005'],
        ]);

        // Orders
        await client.query(`
      insert into orders (
        order_number,
        customer_id,
        order_date,
        requested_delivery_date,
        status,
        payment_status,
        fulfilment_status,
        assigned_driver_or_route,
        notes,
        total_value,
        issue_count
      )
      values
        (
          'ORD-1001',
          $1,
          current_date,
          current_date,
          'Approved',
          'Unpaid',
          'Allocated',
          'Route A / Driver Marko',
          'Due today and ready for picking',
          480.00,
          0
        ),
        (
          'ORD-1002',
          $2,
          current_date - interval '2 days',
          current_date - interval '1 day',
          'Picking',
          'Overdue',
          'Partially Fulfilled',
          'Route B / Driver Ivan',
          'Missing part of stock for one SKU',
          920.00,
          1
        ),
        (
          'ORD-1003',
          $3,
          current_date - interval '3 days',
          current_date + interval '1 day',
          'Out for delivery',
          'Partially Paid',
          'Fulfilled',
          'Route C / Driver Ana',
          'Customer requested call before arrival',
          300.00,
          0
        ),
        (
          'ORD-1004',
          $1,
          current_date - interval '5 days',
          current_date - interval '3 days',
          'Blocked',
          'Overdue',
          'Issue',
          'Unassigned',
          'Blocked due to overdue balance',
          1250.00,
          2
        ),
        (
          'ORD-1005',
          $2,
          current_date,
          current_date + interval '2 days',
          'New',
          'Unpaid',
          'Unallocated',
          null,
          'New order waiting approval',
          210.00,
          0
        )
      on conflict (order_number) do nothing
    `, [
            customerMap['Delta Foods'],
            customerMap['Nova Market'],
            customerMap['Fresh Trade'],
        ]);

        const allOrders = await client.query(`
      select id, order_number from orders
      where order_number in ('ORD-1001', 'ORD-1002', 'ORD-1003', 'ORD-1004', 'ORD-1005')
    `);

        const orderMap = Object.fromEntries(
            allOrders.rows.map((o) => [o.order_number, o.id])
        );

        // Order items
        const existingOrderItems = await client.query(`select count(*)::int as count from order_items`);
        if (existingOrderItems.rows[0].count === 0) {
            await client.query(`
        insert into order_items (order_id, product_id, qty_ordered, qty_shipped, unit_price)
        values
          ($1, $6, 20, 20, 6.00),
          ($1, $7, 10, 10, 36.00),

          ($2, $6, 30, 20, 6.00),
          ($2, $8, 15, 5, 22.00),

          ($3, $9, 12, 12, 25.00),

          ($4, $7, 25, 0, 50.00),

          ($5, $10, 14, 0, 15.00)
      `, [
                orderMap['ORD-1001'],
                orderMap['ORD-1002'],
                orderMap['ORD-1003'],
                orderMap['ORD-1004'],
                orderMap['ORD-1005'],
                productMap['SKU-001'],
                productMap['SKU-002'],
                productMap['SKU-003'],
                productMap['SKU-004'],
                productMap['SKU-005'],
            ]);
        }

        // Deliveries
        await client.query(`
      insert into deliveries (
        order_id,
        scheduled_date,
        delivered_at,
        status,
        driver_name,
        route_name,
        notes
      )
      values
        (
          $1,
          current_date,
          null,
          'Scheduled',
          'Marko',
          'Route A',
          'Morning route'
        ),
        (
          $2,
          current_date - interval '1 day',
          null,
          'Delayed',
          'Ivan',
          'Route B',
          'Vehicle issue caused delay'
        ),
        (
          $3,
          current_date,
          null,
          'In Progress',
          'Ana',
          'Route C',
          'On route'
        )
      on conflict do nothing
    `, [
            orderMap['ORD-1001'],
            orderMap['ORD-1002'],
            orderMap['ORD-1003'],
        ]);

        // Invoices
        await client.query(`
      insert into invoices (
        order_id,
        customer_id,
        invoice_number,
        amount,
        due_date,
        paid_amount,
        status
      )
      values
        (
          $1,
          $4,
          'INV-1001',
          480.00,
          current_date + interval '7 days',
          0,
          'Open'
        ),
        (
          $2,
          $5,
          'INV-1002',
          920.00,
          current_date - interval '2 days',
          200.00,
          'Overdue'
        ),
        (
          $3,
          $6,
          'INV-1003',
          300.00,
          current_date + interval '5 days',
          150.00,
          'Partially Paid'
        ),
        (
          $4,
          $4,
          'INV-1004',
          1250.00,
          current_date - interval '10 days',
          0,
          'Overdue'
        )
      on conflict (invoice_number) do nothing
    `, [
            orderMap['ORD-1001'],
            orderMap['ORD-1002'],
            orderMap['ORD-1003'],
            orderMap['ORD-1004'],
            customerMap['Delta Foods'],
            customerMap['Nova Market'],
            customerMap['Fresh Trade'],
        ]);

        // Payments
        const invoiceRows = await client.query(`
      select id, invoice_number
      from invoices
      where invoice_number in ('INV-1002', 'INV-1003')
    `);

        const invoiceMap = Object.fromEntries(
            invoiceRows.rows.map((i) => [i.invoice_number, i.id])
        );

        const existingPayments = await client.query(`select count(*)::int as count from payments`);
        if (existingPayments.rows[0].count === 0) {
            await client.query(`
        insert into payments (customer_id, invoice_id, amount, paid_at, method)
        values
          ($1, $3, 200.00, now() - interval '3 days', 'Bank transfer'),
          ($2, $4, 150.00, now() - interval '1 day', 'Cash')
      `, [
                customerMap['Nova Market'],
                customerMap['Fresh Trade'],
                invoiceMap['INV-1002'],
                invoiceMap['INV-1003'],
            ]);
        }

        await client.query('COMMIT');
        console.log('Seed complete.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seed();