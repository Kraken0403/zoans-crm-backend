const db = require('../config/db');
const { addOrUpdateCustomFields } = require('./customFieldValues');

// Helper to normalize date
const normalizeDate = (date) => {
  if (!date) return null;
  const parsed = new Date(date);
  return isNaN(parsed) ? null : parsed.toISOString().slice(0, 10);
};

/* ============================================================
   CREATE LEAD (WITH TRANSACTION)
============================================================ */
exports.createLead = async (req, res) => {
  const {
    first_name,
    last_name,
    company_name,
    lead_status,
    email,
    phone_number,
    gst_number,
    contact_name,
    follow_up_date,
    priority,
    assigned_salesperson,
    hotness,
    amount,
    notes,
    custom_fields = [],
    shipping_address,
    shipping_landmark,
    shipping_city,
    shipping_state,
    shipping_pincode,
    billing_address,
    billing_landmark,
    billing_city,
    billing_state,
    billing_pincode,
    source
  } = req.body;

  const created_by = req.user?.username || 'None';
  const normalizedFollowUpDate = normalizeDate(follow_up_date);

  // ✅ NEVER allow NULL source
  const safeSource = source && source.trim() !== '' ? source : 'CRM';

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
      INSERT INTO leads (
        first_name, last_name, company_name, lead_status, email, phone_number,
        gst_number, contact_name, follow_up_date, priority, assigned_salesperson,
        hotness, amount, notes, created_by,
        shipping_address, shipping_landmark, shipping_city, shipping_state, shipping_pincode,
        billing_address, billing_landmark, billing_city, billing_state, billing_pincode,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?)
      `,
      [
        first_name,
        last_name,
        company_name,
        lead_status,
        email,
        phone_number,
        gst_number,
        contact_name,
        normalizedFollowUpDate,
        priority,
        assigned_salesperson,
        hotness,
        amount,
        notes,
        created_by,
        shipping_address,
        shipping_landmark,
        shipping_city,
        shipping_state,
        shipping_pincode,
        billing_address,
        billing_landmark,
        billing_city,
        billing_state,
        billing_pincode,
        safeSource // ✅ FIXED
      ]
    );

    const leadId = result.insertId;

    if (custom_fields.length) {
      await addOrUpdateCustomFields(leadId, custom_fields, connection);
    }

    await connection.commit();

    return res.status(201).json({
      message: 'Lead created successfully',
      leadId
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('CREATE LEAD ERROR:', err);
    return res.status(500).json({
      error: 'Failed to create lead',
      details: err.message
    });
  } finally {
    if (connection) connection.release();
  }
};

/* ============================================================
   GET ALL LEADS
============================================================ */
exports.getAllLeads = async (req, res) => {
  try {
    const [leads] = await db.query('SELECT * FROM leads');

    if (!leads.length) {
      return res.status(200).json({ leads: [] });
    }

    const leadIds = leads.map(l => l.id);

    const [fields] = await db.query(
      'SELECT * FROM lead_field_values WHERE lead_id IN (?)',
      [leadIds]
    );

    const leadsWithFields = leads.map(lead => ({
      ...lead,
      custom_fields: fields.filter(f => f.lead_id === lead.id)
    }));

    return res.status(200).json({ leads: leadsWithFields });

  } catch (err) {
    console.error('GET ALL LEADS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch leads',
      details: err.message
    });
  }
};


/* ============================================================
   GET LEAD BY ID
============================================================ */
exports.getLeadById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      'SELECT * FROM leads WHERE id = ?',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = rows[0];

    const [customFields] = await db.query(
      'SELECT * FROM lead_field_values WHERE lead_id = ?',
      [id]
    );

    lead.custom_fields = customFields;

    return res.status(200).json(lead);

  } catch (err) {
    console.error('GET LEAD ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch lead',
      details: err.message
    });
  }
};


/* ============================================================
   UPDATE LEAD (WITH TRANSACTION)
============================================================ */
exports.updateLead = async (req, res) => {
  const { id } = req.params;

  const {
    first_name,
    last_name,
    company_name,
    lead_status,
    email,
    phone_number,
    gst_number,
    contact_name,
    follow_up_date,
    priority,
    assigned_salesperson,
    hotness,
    amount,
    notes,
    custom_fields = [],
    shipping_address,
    shipping_landmark,
    shipping_city,
    shipping_state,
    shipping_pincode,
    billing_address,
    billing_landmark,
    billing_city,
    billing_state,
    billing_pincode,
    source
  } = req.body;

  const normalizedFollowUpDate = normalizeDate(follow_up_date);

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // ✅ Get existing source first
    const [[existingLead]] = await connection.query(
      `SELECT source FROM leads WHERE id = ?`,
      [id]
    );

    if (!existingLead) {
      await connection.rollback();
      return res.status(404).json({ message: 'Lead not found' });
    }

    // ✅ Preserve old source if not provided
    const safeSource =
      source && source.trim() !== ''
        ? source
        : existingLead.source || 'CRM';

    const [result] = await connection.query(
      `
      UPDATE leads SET
        first_name = ?, 
        last_name = ?, 
        company_name = ?, 
        lead_status = ?, 
        email = ?, 
        phone_number = ?, 
        gst_number = ?, 
        contact_name = ?, 
        follow_up_date = ?, 
        priority = ?, 
        assigned_salesperson = ?, 
        hotness = ?, 
        amount = ?, 
        notes = ?,
        shipping_address = ?, 
        shipping_landmark = ?, 
        shipping_city = ?, 
        shipping_state = ?, 
        shipping_pincode = ?,
        billing_address = ?, 
        billing_landmark = ?, 
        billing_city = ?, 
        billing_state = ?, 
        billing_pincode = ?,
        source = ?
      WHERE id = ?
      `,
      [
        first_name,
        last_name,
        company_name,
        lead_status,
        email,
        phone_number,
        gst_number,
        contact_name,
        normalizedFollowUpDate,
        priority,
        assigned_salesperson,
        hotness,
        amount,
        notes,
        shipping_address,
        shipping_landmark,
        shipping_city,
        shipping_state,
        shipping_pincode,
        billing_address,
        billing_landmark,
        billing_city,
        billing_state,
        billing_pincode,
        safeSource, // ✅ FIXED
        id
      ]
    );

    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (custom_fields.length) {
      await addOrUpdateCustomFields(id, custom_fields, connection);
    }

    await connection.commit();

    return res.status(200).json({
      message: 'Lead and custom fields updated successfully'
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('UPDATE LEAD ERROR:', err);
    return res.status(500).json({
      error: 'Failed to update lead',
      details: err.message
    });
  } finally {
    if (connection) connection.release();
  }
};


/* ============================================================
   DELETE LEAD (WITH TRANSACTION)
============================================================ */
exports.deleteLead = async (req, res) => {
  const { id } = req.params;

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(
      'DELETE FROM lead_field_values WHERE lead_id = ?',
      [id]
    );

    const [result] = await connection.query(
      'DELETE FROM leads WHERE id = ?',
      [id]
    );

    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Lead not found' });
    }

    await connection.commit();

    return res.status(200).json({
      message: 'Lead and related custom fields deleted successfully'
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('DELETE LEAD ERROR:', err);
    return res.status(500).json({
      error: 'Failed to delete lead',
      details: err.message
    });
  } finally {
    if (connection) connection.release();
  }
};
