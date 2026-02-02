const db = require('../config/db');
const { addOrUpdateCustomFields, getCustomFieldsByLeadId } = require('./customFieldValues');

// Helper to normalize date
const normalizeDate = (date) => {
    if (!date) return null;
    const parsed = new Date(date);
    return isNaN(parsed) ? null : parsed.toISOString().slice(0, 10);
};

/* ----------------------------------------------
   CREATE LEAD (WITH TRANSACTION)
---------------------------------------------- */
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
        custom_fields,
    } = req.body;

    const created_by = req.user?.username || 'None';
    const normalizedFollowUpDate = normalizeDate(follow_up_date);

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const leadQuery = `
            INSERT INTO leads 
            (first_name, last_name, company_name, lead_status, email, phone_number,
            gst_number,
            contact_name, follow_up_date, priority, assigned_salesperson, hotness, 
            amount, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const leadValues = [
            first_name, last_name, company_name, lead_status, email, phone_number,
            gst_number,
            contact_name, normalizedFollowUpDate, priority, assigned_salesperson,
            hotness, amount, notes, created_by,
        ];

        const [result] = await connection.query(leadQuery, leadValues);
        const leadId = result.insertId;

        // Custom fields
        await addOrUpdateCustomFields(leadId, custom_fields, connection);

        await connection.commit();

        res.status(201).json({ message: 'Lead created successfully', leadId });

    } catch (err) {
        console.error(err);
        if (connection) await connection.rollback();
        res.status(500).json({ error: 'Failed to create lead', details: err.message });
    } finally {
        if (connection) connection.release();
    }
};


/* ----------------------------------------------
   GET ALL LEADS
---------------------------------------------- */
exports.getAllLeads = (req, res) => {
    const leadsQuery = 'SELECT * FROM leads';
    const customFieldsQuery = 'SELECT * FROM lead_field_values WHERE lead_id IN (?)';

    db.query(leadsQuery, (err, leads) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch leads', details: err.message });

        const leadIds = leads.map((lead) => lead.id);
        if (leadIds.length === 0) return res.status(200).json({ leads: [] });

        db.query(customFieldsQuery, [leadIds], (err, fields) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch custom fields', details: err.message });

            const leadsWithFields = leads.map((lead) => ({
                ...lead,
                custom_fields: fields.filter((f) => f.lead_id === lead.id),
            }));

            res.status(200).json({ leads: leadsWithFields });
        });
    });
};


/* ----------------------------------------------
   GET LEAD BY ID
---------------------------------------------- */
exports.getLeadById = (req, res) => {
    const { id } = req.params;

    const leadQuery = 'SELECT * FROM leads WHERE id = ?';

    db.query(leadQuery, [id], (err, leads) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch lead', details: err.message });

        if (leads.length === 0) return res.status(404).json({ message: 'Lead not found' });

        const lead = leads[0];

        getCustomFieldsByLeadId(id, (err, customFields) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch custom fields', details: err.message });

            lead.custom_fields = customFields;
            res.status(200).json(lead);
        });
    });
};


/* ----------------------------------------------
   UPDATE LEAD (WITH TRANSACTION)
---------------------------------------------- */
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
        custom_fields,
    } = req.body;

    const normalizedFollowUpDate = normalizeDate(follow_up_date);

    const leadQuery = `
        UPDATE leads
        SET first_name = ?, last_name = ?, company_name = ?, lead_status = ?, email = ?, 
            phone_number = ?, gst_number = ?, contact_name = ?, follow_up_date = ?, priority = ?, 
            assigned_salesperson = ?, hotness = ?, amount = ?, notes = ?
        WHERE id = ?
    `;

    const leadValues = [
        first_name, last_name, company_name, lead_status, email, phone_number,
        gst_number,
        contact_name, normalizedFollowUpDate, priority, assigned_salesperson,
        hotness, amount, notes, id,
    ];
    

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        // Update main lead data
        await connection.query(leadQuery, leadValues);

        // Update custom fields
        await addOrUpdateCustomFields(id, custom_fields, connection);

        await connection.commit();

        res.status(200).json({ message: 'Lead and custom fields updated successfully' });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to update lead', details: err.message });
    } finally {
        if (connection) connection.release();
    }
};


/* ----------------------------------------------
   DELETE LEAD (WITH TRANSACTION)
---------------------------------------------- */
exports.deleteLead = async (req, res) => {
    const { id } = req.params;

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        await connection.query('DELETE FROM lead_field_values WHERE lead_id = ?', [id]);

        const [result] = await connection.query('DELETE FROM leads WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Lead not found' });
        }

        await connection.commit();

        res.status(200).json({ message: 'Lead and related custom fields deleted successfully' });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to delete lead', details: err.message });
    } finally {
        if (connection) connection.release();
    }
};
