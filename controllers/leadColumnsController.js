const db = require('../config/db');

// Fetch actual DB columns
exports.getLeadFields = (req, res) => {
    const query = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'leads' 
          AND TABLE_SCHEMA = DATABASE();
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching lead fields:', err);
            return res.status(500).json({ error: 'Failed to fetch lead fields.', details: err.message });
        }

        const fieldNames = results.map((field) => field.COLUMN_NAME);
        return res.status(200).json({ fields: fieldNames });
    });
};


// Save new order
exports.saveFieldOrder = (req, res) => {
    const { fields } = req.body;

    if (!fields || fields.length === 0) {
        return res.status(400).json({ error: 'No fields provided.' });
    }

    if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated.' });
    }

    const userId = req.user.id;
    const fieldsJson = JSON.stringify(fields);

    const query = `
        INSERT INTO field_order (user_id, fields)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE fields = ?;
    `;

    db.query(query, [userId, fieldsJson, fieldsJson], (err) => {
        if (err) {
            console.error('Error saving field order:', err);
            return res.status(500).json({ error: 'Error saving field order.', details: err.message });
        }

        return res.status(200).json({ message: 'Field order saved successfully.' });
    });
};


// Get saved order
exports.getFieldOrder = (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated.' });
    }

    const userId = req.user.id;

    const query = `
        SELECT fields FROM field_order WHERE user_id = ?;
    `;

    db.query(query, [userId], (err, result) => {
        if (err) {
            console.error('Error fetching field order:', err);
            return res.status(500).json({ error: 'Error fetching field order.', details: err.message });
        }

        // First time user: no order saved → return empty array
        if (result.length === 0) {
            return res.status(200).json({ fieldOrder: [] });
        }

        // PARSE the JSON string
        let parsed = [];
        try {
            parsed = JSON.parse(result[0].fields);
        } catch {
            parsed = [];
        }

        return res.status(200).json({ fieldOrder: parsed });
    });
};
