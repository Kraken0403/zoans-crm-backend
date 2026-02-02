const db = require('../config/db');
const fs = require('fs');

// UPLOAD FILE
exports.uploadFile = (req, res) => {
    const { leadId } = req.params;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const file_name = req.file.originalname;
    const file_path = req.file.path;
    const uploaded_by = req.user?.username || 'Unknown';

    const query = `
        INSERT INTO files (lead_id, file_name, file_path, uploaded_by)
        VALUES (?, ?, ?, ?)
    `;

    db.query(query, [leadId, file_name, file_path, uploaded_by], (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to upload file', details: err.message });
        res.status(201).json({ message: 'File uploaded', fileId: result.insertId });
    });
};

// LIST FILES
exports.getFilesByLead = (req, res) => {
    const { leadId } = req.params;

    db.query('SELECT * FROM files WHERE lead_id=? ORDER BY uploaded_at DESC', [leadId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch files', details: err.message });
        res.status(200).json(rows);
    });
};

// DELETE FILE
exports.deleteFile = (req, res) => {
    const { id } = req.params;

    db.query('SELECT file_path FROM files WHERE id=?', [id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to delete file', details: err.message });

        if (rows.length === 0) return res.status(404).json({ message: 'File not found' });

        const filePath = rows[0].file_path;

        fs.unlink(filePath, () => {});

        db.query('DELETE FROM files WHERE id=?', [id], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to remove file record', details: err.message });

            res.status(200).json({ message: 'File deleted' });
        });
    });
};
