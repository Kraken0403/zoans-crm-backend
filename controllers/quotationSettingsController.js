const db = require('../config/db');

// ---------------------------------------------------------
// Get Quotation Settings - Always return valid defaults
// ---------------------------------------------------------
const getQuotationSettings = async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT * FROM quotation_settings LIMIT 1`
    );

    if (!results.length) {
      // Return default values if no settings exist
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
        quotation_mode: 'GENERAL',
        gst_pricing_mode: 'EXCLUSIVE'
      });
    }

    return res.status(200).json(results[0]);

  } catch (err) {
    console.error('getQuotationSettings error:', err);
    return res.status(500).json({
      error: 'Failed to fetch settings',
      details: err.message
    });
  }
};


// ---------------------------------------------------------
// Save / Upsert Settings
// ---------------------------------------------------------
const saveQuotationSettings = async (req, res) => {
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
    quotation_mode,
    gst_pricing_mode
  } = req.body;

  try {
    await db.query(
      `
      INSERT INTO quotation_settings
        (id, layout_option, logo_url,
         terms_conditions_html, cover_letter_html, footer_notes_html,
         prefix, sequence_start, number_format,
         numbering_mode, quotation_mode, gst_pricing_mode)
      VALUES
        (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        quotation_mode = VALUES(quotation_mode),
        gst_pricing_mode = VALUES(gst_pricing_mode)
      `,
      [
        layout_option || 'minimal',
        logo_url || '',
        terms_conditions_html || '',
        cover_letter_html || '',
        footer_notes_html || '',
        prefix || 'QT',
        sequence_start || 1,
        number_format || '{prefix}/{year}/{seq}',
        numbering_mode || 'continuous',
        quotation_mode || 'GENERAL',
        gst_pricing_mode || 'EXCLUSIVE'
      ]
    );

    return res.status(200).json({
      message: 'Quotation settings saved successfully'
    });

  } catch (err) {
    console.error('saveQuotationSettings error:', err);
    return res.status(500).json({
      error: 'Failed to save settings',
      details: err.message
    });
  }
};


module.exports = {
  getQuotationSettings,
  saveQuotationSettings
};
