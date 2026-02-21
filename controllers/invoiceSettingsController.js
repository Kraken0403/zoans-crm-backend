const db = require('../config/db')

/* ---------------------------------------------------------
   GET INVOICE SETTINGS
--------------------------------------------------------- */
exports.getInvoiceSettings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM invoice_settings LIMIT 1`
    )

    if (!rows.length) {
      return res.status(200).json({
        prefix: 'INV',
        sequence_start: 1,
        number_format: '{prefix}/{year}/{seq}',
        numbering_mode: 'continuous',
        layout_option: 'minimal',
        terms_conditions_html: '',
        footer_notes_html: '',
      })
    }

    return res.status(200).json(rows[0])
  } catch (err) {
    console.error('getInvoiceSettings error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* ---------------------------------------------------------
   SAVE INVOICE SETTINGS
--------------------------------------------------------- */
exports.saveInvoiceSettings = async (req, res) => {
  const {
    prefix,
    sequence_start,
    number_format,
    numbering_mode,
    layout_option,
    terms_conditions_html,
    footer_notes_html,
  } = req.body

  try {
    const [existing] = await db.query(
      `SELECT id FROM invoice_settings LIMIT 1`
    )

    if (existing.length) {
      await db.query(
        `
        UPDATE invoice_settings
        SET
          prefix = ?,
          sequence_start = ?,
          number_format = ?,
          numbering_mode = ?,
          layout_option = ?,
          terms_conditions_html = ?,
          footer_notes_html = ?
        WHERE id = ?
        `,
        [
          prefix,
          sequence_start,
          number_format,
          numbering_mode,
          layout_option,
          terms_conditions_html,
          footer_notes_html,
          existing[0].id,
        ]
      )
    } else {
      await db.query(
        `
        INSERT INTO invoice_settings
        (
          prefix,
          sequence_start,
          number_format,
          numbering_mode,
          layout_option,
          terms_conditions_html,
          footer_notes_html
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          prefix,
          sequence_start,
          number_format,
          numbering_mode,
          layout_option,
          terms_conditions_html,
          footer_notes_html,
        ]
      )
    }

    return res.status(200).json({
      message: 'Invoice settings saved successfully',
    })
  } catch (err) {
    console.error('saveInvoiceSettings error:', err)
    return res.status(500).json({ error: err.message })
  }
}
