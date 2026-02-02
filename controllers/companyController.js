const db = require('../config/db');

const createCompany = (req, res) => {
  const { name, gst_number, pan_number, email, phone, website, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Company name is required.' });
  }

  const query = `
    INSERT INTO companies (name, gst_number, pan_number, email, phone, website, address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [name, gst_number, pan_number, email, phone, website, address], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create company', details: err.message });
    }
    res.status(201).json({ message: 'Company created successfully', companyId: result.insertId });
  });
};

const getCompanies = (req, res) => {
  db.query('SELECT * FROM companies', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch companies', details: err.message });
    }
    res.status(200).json(results);
  });
};

const getCompanyById = (req, res) => {
  db.query('SELECT * FROM companies WHERE id = ?', [req.params.id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch company', details: err.message });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.status(200).json(results[0]);
  });
};

const updateCompany = (req, res) => {
  const { id } = req.params;
  const { name, gst_number, pan_number, email, phone, website, address } = req.body;

  const query = `
    UPDATE companies 
    SET name = ?, gst_number = ?, pan_number = ?, email = ?, phone = ?, website = ?, address = ?
    WHERE id = ?
  `;

  db.query(query, [name, gst_number, pan_number, email, phone, website, address, id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update company', details: err.message });
    }
    res.status(200).json({ message: 'Company updated successfully.' });
  });
};

const deleteCompany = (req, res) => {
  db.query('DELETE FROM companies WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete company', details: err.message });
    }
    res.status(200).json({ message: 'Company deleted successfully.' });
  });
};

module.exports = {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
};
