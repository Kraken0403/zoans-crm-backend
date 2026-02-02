const db = require("../config/db");
const path = require("path");
const fs = require("fs");

/* --------------------------------------------------
   ENSURE SETTINGS ROW EXISTS (id = 1)
-------------------------------------------------- */
function ensureSettingsRowExists() {
  return new Promise((resolve, reject) => {
    db.query("SELECT id FROM settings WHERE id = 1", (err, rows) => {
      if (err) return reject(err);

      if (rows.length > 0) return resolve(true);

      // Insert default row (GST ENABLED + INCLUSIVE by default)
      const insertSql = `
        INSERT INTO settings (
          id,
          company_name,
          company_email,
          company_phone,
          currency_code,

          gst_enabled,
          gst_pricing_mode,

          company_country
        )
        VALUES (
          1,
          '',
          '',
          '',
          'INR',
          1,
          'INCLUSIVE',
          'India'
        )
      `;

      db.query(insertSql, (err2) => {
        if (err2) return reject(err2);
        resolve(true);
      });
    });
  });
}

/* --------------------------------------------------
   GET SETTINGS
-------------------------------------------------- */
exports.getSettings = async (req, res) => {
  try {
    await ensureSettingsRowExists();

    db.query("SELECT * FROM settings WHERE id = 1", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows[0] || {});
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* --------------------------------------------------
   UPDATE SETTINGS
-------------------------------------------------- */
exports.updateSettings = async (req, res) => {
  try {
    await ensureSettingsRowExists();

    const {
      company_name,
      company_email,
      company_phone,

      // Address fields
      company_address_line1,
      company_address_line2,
      company_city,
      company_state,
      company_pincode,
      company_country,

      // GST fields
      gst_enabled,
      gst_pricing_mode,
      gst_number,
      gst_state_code,

      currency_code
    } = req.body;

    // Handle logo upload
    const logoPath = req.file ? `/uploads/${req.file.filename}` : null;

    const sql = `
      UPDATE settings
      SET
        company_name = ?,
        company_email = ?,
        company_phone = ?,

        company_address_line1 = ?,
        company_address_line2 = ?,
        company_city = ?,
        company_state = ?,
        company_pincode = ?,
        company_country = ?,

        gst_enabled = ?,
        gst_pricing_mode = ?,
        gst_number = ?,
        gst_state_code = ?,

        currency_code = ?,
        company_logo = COALESCE(?, company_logo)

      WHERE id = 1
    `;

    db.query(
      sql,
      [
        company_name || '',
        company_email || '',
        company_phone || '',

        company_address_line1 || '',
        company_address_line2 || '',
        company_city || '',
        company_state || '',
        company_pincode || '',
        company_country || 'India',

        gst_enabled !== undefined ? (gst_enabled ? 1 : 0) : 1,
        gst_pricing_mode || 'INCLUSIVE',
        gst_number || '',
        gst_state_code || '',

        currency_code || 'INR',
        logoPath
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          message: "Settings updated successfully",
          company_logo: logoPath || undefined
        });
      }
    );

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
