import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
});

pool.on('error', (err) => {
    console.error('Postgres pool error:', err);
});

async function query(text, params) {
    return pool.query(text, params);
}

export { pool, query };