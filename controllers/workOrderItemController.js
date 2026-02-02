const db = require('../config/db');

// Get a single WorkOrderItem by ID
const getWorkOrderItemById = (req, res) => {
    const { id } = req.params;
    

    const query = `SELECT * FROM WorkOrderItems WHERE WorkOrderID = ?`;

    db.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error fetching WorkOrderItem:', err);
            return res.status(500).json({ error: 'Error fetching WorkOrderItem.', details: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'WorkOrderItem not found' });
        }

        res.status(200).json(results);
    });
};


// Create a new WorkOrderItem
const createWorkOrderItem = (req, res) => {
    const { WorkOrderID, ProductName, MakingSize, Number, Weight, TotalRft, TotalSqft, SlittingSize, Thickness } = req.body;

    // Validate required fields
    if (!WorkOrderID || !ProductName || !MakingSize || !Number || !Weight || !TotalRft || !TotalSqft || !SlittingSize || !Thickness) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const query = `
        INSERT INTO WorkOrderItems (WorkOrderID, ProductName, MakingSize, Number, Weight, TotalRft, TotalSqft, SlittingSize, Thickness) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    db.query(query, [WorkOrderID, ProductName, MakingSize, Number, Weight, TotalRft, TotalSqft, SlittingSize, Thickness], (err, result) => {
        if (err) {
            console.error('Error saving WorkOrderItem:', err);
            return res.status(500).json({ error: 'Error saving WorkOrderItem.', details: err.message });
        }

        res.status(201).json({ message: 'Work order item saved successfully.', workOrderItemID: result.insertId });
    });
};




module.exports = {
    getWorkOrderItemById,
    createWorkOrderItem,
};
