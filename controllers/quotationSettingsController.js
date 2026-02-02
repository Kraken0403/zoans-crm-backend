const db = require('../config/db');

// ---------------------------------------------------------
// Get Quotation Settings - Always return valid defaults
// ---------------------------------------------------------
const getQuotationSettings = (req, res) => {
  db.query('SELECT * FROM quotation_settings LIMIT 1', (err, results) => {
    if (err)
      return res.status(500).json({
        error: 'Failed to fetch settings',
        details: err.message
      });

    if (results.length === 0) {
      // Return default settings instead of 404
      return res.status(200).json({
        id: 1,
        layout_option: 'minimal',
        logo_url: '',
        terms_conditions_html: '',
        cover_letter_html: '',
        footer_notes_html: '',
        prefix: 'QT',
        sequence_start: 1,
        number_format: '{prefix}/{year}/{seq}',
        numbering_mode: 'continuous',
        quotation_mode: 'GENERAL'
      });
    }
    console.log(results)
    res.status(200).json(results[0]);
  });
};

// ---------------------------------------------------------
// Save / Upsert Settings
// ---------------------------------------------------------
const saveQuotationSettings = (req, res) => {
  const {
    layout_option,
    logo_url,
    terms_conditions_html,
    cover_letter_html,
    footer_notes_html,
    prefix,
    sequence_start,
    number_format,
    numbering_mode,
    quotation_mode
  } = req.body;

  const query = `
    INSERT INTO quotation_settings 
      (id, layout_option, logo_url, terms_conditions_html, cover_letter_html, footer_notes_html, 
       prefix, sequence_start, number_format, numbering_mode, quotation_mode)
    VALUES 
      (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      layout_option = VALUES(layout_option),
      logo_url = VALUES(logo_url),
      terms_conditions_html = VALUES(terms_conditions_html),
      cover_letter_html = VALUES(cover_letter_html),
      footer_notes_html = VALUES(footer_notes_html),
      prefix = VALUES(prefix),
      sequence_start = VALUES(sequence_start),
      number_format = VALUES(number_format),
      numbering_mode = VALUES(numbering_mode),
      quotation_mode = VALUES(quotation_mode)
  `;

  db.query(
    query,
    [
      layout_option,
      logo_url,
      terms_conditions_html,
      cover_letter_html,
      footer_notes_html,
      prefix,
      sequence_start,
      number_format,
      numbering_mode,
      quotation_mode || 'GENERAL'
    ],
    (err) => {
      if (err)
        return res.status(500).json({
          error: 'Failed to save settings',
          details: err.message
        });

      res.status(200).json({ message: 'Quotation settings saved successfully' });
    }
  );
};

module.exports = {
  getQuotationSettings,
  saveQuotationSettings
};
