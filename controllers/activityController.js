const db = require('../config/db');

// ADD ACTIVITY
exports.addActivity = (req, res) => {
    const { leadId } = req.params;
    const {
        type,
        title,
        description,
        due_date,
        due_time,
        status
    } = req.body;

    const created_by = req.user?.username || 'Unknown';

    const query = `
        INSERT INTO activities 
        (lead_id, type, title, description, due_date, due_time, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        query,
        [leadId, type, title, description, due_date, due_time, status || 'open', created_by],
        (err, result) => {
            if (err) return res.status(500).json({ error: 'Failed to add activity', details: err.message });
            res.status(201).json({ message: 'Activity added', activityId: result.insertId });
        }
    );
};

// GET ACTIVITIES FOR A LEAD
exports.getActivitiesByLead = (req, res) => {
    const { leadId } = req.params;

    db.query('SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC',
        [leadId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch activities', details: err.message });
            res.status(200).json(rows);
        }
    );
};

// UPDATE ACTIVITY
exports.updateActivity = (req, res) => {
    const { id } = req.params;
    const { type, title, description, due_date, due_time, status } = req.body;

    const query = `
        UPDATE activities SET 
        type=?, title=?, description=?, due_date=?, due_time=?, status=?
        WHERE id=?
    `;

    db.query(query, [type, title, description, due_date, due_time, status, id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update activity', details: err.message });
        res.status(200).json({ message: 'Activity updated' });
    });
};

// DELETE ACTIVITY
exports.deleteActivity = (req, res) => {
    const { id } = req.params;

    db.query('DELETE FROM activities WHERE id=?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to delete activity', details: err.message });
        res.status(200).json({ message: 'Activity deleted' });
    });
};
