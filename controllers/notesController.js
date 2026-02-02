const db = require('../config/db');

// ADD NOTE
exports.addNote = (req, res) => {
    const { leadId } = req.params;
    const { note_text } = req.body;
    const created_by = req.user?.username || 'Unknown';

    const query = `
        INSERT INTO notes (lead_id, note_text, created_by)
        VALUES (?, ?, ?)
    `;

    db.query(query, [leadId, note_text, created_by], (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to add note', details: err.message });
        res.status(201).json({ message: 'Note added', noteId: result.insertId });
    });
};

// GET NOTES FOR A LEAD
exports.getNotesByLead = (req, res) => {
    const { leadId } = req.params;

    db.query('SELECT * FROM notes WHERE lead_id=? ORDER BY created_at DESC', [leadId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch notes', details: err.message });
        res.status(200).json(rows);
    });
};

exports.updateNote = (req, res) => {
    const { id } = req.params;
    const { note_text } = req.body;

    const query = `
        UPDATE notes 
        SET note_text = ?
        WHERE id = ?
    `;

    db.query(query, [note_text, id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to update note', details: err.message });

        if (result.affectedRows === 0)
            return res.status(404).json({ message: 'Note not found' });

        res.status(200).json({ message: 'Note updated successfully' });
    });
};


// DELETE NOTE
exports.deleteNote = (req, res) => {
    const { id } = req.params;

    db.query('DELETE FROM notes WHERE id=?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to delete note', details: err.message });
        res.status(200).json({ message: 'Note deleted' });
    });
};
