require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Add this query helper so routes can use it
async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { pool, query };