// controllers/invoiceController.js
const db = require('../config/db')
const {
  generateInvoiceNumber,
  calculateGSTLine,
  computeInvoiceTotals,
} = require('../utils/invoiceUtils')

/* ---------------------------------------------------------
   Load company settings (gst_pricing_mode + company_state etc.)
--------------------------------------------------------- */
async function getCompanySettings(conn) {
  const [[settings]] = await conn.query(`SELECT * FROM settings LIMIT 1`)
  return settings || {}
}

/* ---------------------------------------------------------
   Load invoice settings (numbering + prefix)
--------------------------------------------------------- */
async function getInvoiceSettings(conn) {
  const [[s]] = await conn.query(`SELECT * FROM invoice_settings LIMIT 1`)
  return (
    s || {
      prefix: 'INV',
      sequence_start: 1,
      number_format: '{prefix}/{year}/{seq}',
      numbering_mode: 'continuous',
      layout_option: 'minimal',
    }
  )
}

/* ---------------------------------------------------------
   Get next sequence based on numbering_mode
   - continuous: max(invoice_sequence)+1 (global)
   - yearly: max sequence within year
   - monthly: max sequence within year+month
--------------------------------------------------------- */
async function getNextInvoiceSequence(conn, invSettings, now = new Date()) {
  const mode = invSettings.numbering_mode || 'continuous'
  const start = Number(invSettings.sequence_start || 1)

  if (mode === 'yearly') {
    const year = now.getFullYear()
    const [[row]] = await conn.query(
      `
      SELECT MAX(invoice_sequence) AS maxSeq
      FROM invoices
      WHERE YEAR(issue_date) = ?
      `,
      [year]
    )
    return row?.maxSeq ? Number(row.maxSeq) + 1 : start
  }

  if (mode === 'monthly') {
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const [[row]] = await conn.query(
      `
      SELECT MAX(invoice_sequence) AS maxSeq
      FROM invoices
      WHERE YEAR(issue_date) = ? AND MONTH(issue_date) = ?
      `,
      [year, month]
    )
    return row?.maxSeq ? Number(row.maxSeq) + 1 : start
  }

  // continuous
  const [[row]] = await conn.query(
    `SELECT MAX(invoice_sequence) AS maxSeq FROM invoices`
  )
  return row?.maxSeq ? Number(row.maxSeq) + 1 : start
}

/* ---------------------------------------------------------
   Load lead billing snapshot + shipping snapshot
--------------------------------------------------------- */
async function buildLeadSnapshots(conn, leadId) {
  if (!leadId) {
    return { billing: null, shipping: null, lead: null }
  }

  const [[lead]] = await conn.query(`SELECT * FROM leads WHERE id = ?`, [leadId])
  if (!lead) throw new Error('Lead not found')

  const billing = {
    name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
    company: lead.company_name || '',
    phone: lead.phone_number || '',
    email: lead.email || '',
    gst: lead.gst_number || '',

    address: lead.billing_address || '',
    landmark: lead.billing_landmark || '',
    city: lead.billing_city || '',
    state: lead.billing_state || '',
    pincode: lead.billing_pincode || '',
    country: 'India',
  }

  const shipping = {
    name: billing.name,
    company: billing.company,
    phone: billing.phone,
    email: billing.email,
    gst: billing.gst,

    address: lead.shipping_address || lead.billing_address || '',
    landmark: lead.shipping_landmark || lead.billing_landmark || '',
    city: lead.shipping_city || lead.billing_city || '',
    state: lead.shipping_state || lead.billing_state || '',
    pincode: lead.shipping_pincode || lead.billing_pincode || '',
    country: 'India',
  }

  return { billing, shipping, lead }
}

/* ---------------------------------------------------------
   Normalize items input
--------------------------------------------------------- */
function normalizeItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Invoice items are required')
  }

  return items.map(i => ({
    product_id: i.product_id ?? null,
    description: i.description ?? i.product_name ?? 'Item',
    quantity: Number(i.quantity || 0),
    unit_price: Number(i.unit_price || i.selling_price || 0),
    gst_rate: Number(i.gst_rate || 0),
  }))
}

/* ---------------------------------------------------------
   Create invoice (MANUAL / FRONTEND_ORDER generic)
   POST /invoices
--------------------------------------------------------- */
const createInvoice = async (req, res) => {
  const {
    lead_id = null,
    items = [],
    source_type = 'MANUAL', // MANUAL | WORK_ORDER | FRONTEND_ORDER
    source_id = null,
    issue_date = null, // optional
    due_date = null,
    notes = null,
  } = req.body

  let conn
  try {
    conn = await db.getConnection()
    await conn.beginTransaction()

    const companySettings = await getCompanySettings(conn)
    const invSettings = await getInvoiceSettings(conn)

    const { billing, shipping, lead } = await buildLeadSnapshots(conn, lead_id)

    const gstPricingMode = companySettings?.gst_pricing_mode || 'EXCLUSIVE'
    const companyState = (companySettings?.company_state || '').trim()
    const billingState = (lead?.billing_state || '').trim()

    const isInterState =
      !!companyState &&
      !!billingState &&
      companyState.toLowerCase() !== billingState.toLowerCase()

    const normalized = normalizeItems(items)

    // compute per-line
    const computedItems = normalized.map(it => {
      const calc = calculateGSTLine({
        quantity: it.quantity,
        unitPrice: it.unit_price,
        gstRate: it.gst_rate,
        pricingMode: gstPricingMode,
        isInterState,
      })

      return {
        ...it,
        ...calc,
      }
    })

    const totals = computeInvoiceTotals(computedItems)

    const now = issue_date ? new Date(issue_date) : new Date()
    const nextSeq = await getNextInvoiceSequence(conn, invSettings, now)
    const invoiceNumber = generateInvoiceNumber(invSettings, nextSeq, now)

    // insert header
    const [header] = await conn.query(
      `
      INSERT INTO invoices
      (
        invoice_number,
        invoice_sequence,
        source_type,
        source_id,
        lead_id,
        issue_date,
        due_date,
        status,
        billing_snapshot,
        shipping_snapshot,
        subtotal,
        cgst_total,
        sgst_total,
        igst_total,
        grand_total,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        invoiceNumber,
        nextSeq,
        source_type,
        source_id,
        lead_id,
        now.toISOString().slice(0, 10),
        due_date ? String(due_date).slice(0, 10) : null,
        billing ? JSON.stringify(billing) : null,
        shipping ? JSON.stringify(shipping) : null,
        totals.subtotal,
        totals.cgst_total,
        totals.sgst_total,
        totals.igst_total,
        totals.grand_total,
        notes,
      ]
    )

    const invoiceId = header.insertId

    // insert items
    for (const it of computedItems) {
      await conn.query(
        `
        INSERT INTO invoice_items
        (
          invoice_id,
          product_id,
          description,
          quantity,
          unit_price,
          gst_rate,
          taxable_amount,
          cgst_amount,
          sgst_amount,
          igst_amount,
          line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          invoiceId,
          it.product_id,
          it.description,
          it.quantity,
          it.unit_price,
          it.gst_rate,
          it.taxable_amount,
          it.cgst_amount,
          it.sgst_amount,
          it.igst_amount,
          it.line_total,
        ]
      )
    }

    await conn.commit()
    conn.release()

    return res.status(201).json({
      message: 'Invoice created',
      id: invoiceId,
      invoice_number: invoiceNumber,
      totals,
    })
  } catch (err) {
    if (conn) {
      await conn.rollback()
      conn.release()
    }
    console.error('createInvoice error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* ---------------------------------------------------------
   Create invoice from Work Order
   POST /invoices/from-workorder/:workOrderId
--------------------------------------------------------- */
const createInvoiceFromWorkOrder = async (req, res) => {
  const { workOrderId } = req.params

  let conn
  try {
    conn = await db.getConnection()
    await conn.beginTransaction()

    // prevent duplicates
    const [existing] = await conn.query(
      `SELECT id, invoice_number FROM invoices WHERE source_type='WORK_ORDER' AND source_id=? LIMIT 1`,
      [workOrderId]
    )
    if (existing.length) {
      await conn.commit()
      conn.release()
      return res.status(200).json({
        message: 'Invoice already exists for this work order',
        id: existing[0].id,
        invoice_number: existing[0].invoice_number,
        already_existed: true,
      })
    }

    // load work order + lead_id
    const [[wo]] = await conn.query(
      `SELECT * FROM work_orders WHERE id = ?`,
      [workOrderId]
    )
    if (!wo) throw new Error('Work order not found')
    if (!wo.quotation_id) {
      // still ok, but lead_id should exist ideally
    }

    const leadId = wo.lead_id || null

    // load work order items
    const [woItems] = await conn.query(
      `SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id ASC`,
      [workOrderId]
    )
    if (!woItems.length) throw new Error('Work order has no items')

    const companySettings = await getCompanySettings(conn)
    const invSettings = await getInvoiceSettings(conn)
    const { billing, shipping, lead } = await buildLeadSnapshots(conn, leadId)

    const gstPricingMode = companySettings?.gst_pricing_mode || 'EXCLUSIVE'
    const companyState = (companySettings?.company_state || '').trim()
    const billingState = (lead?.billing_state || '').trim()

    const isInterState =
      !!companyState &&
      !!billingState &&
      companyState.toLowerCase() !== billingState.toLowerCase()

    // IMPORTANT: Work order item unit_price already exists (your WO table uses unit_price)
    const normalized = woItems.map(i => ({
      product_id: i.product_id ?? null,
      description: i.product_name || i.description || 'Item',
      quantity: Number(i.quantity || 0),
      unit_price: Number(i.unit_price || 0),
      gst_rate: Number(i.gst_rate || 0), // if wo doesn't have gst_rate column, fallback from products below
    }))

    // If your work_order_items does NOT have gst_rate, pull from products:
    for (const it of normalized) {
      if (!it.gst_rate && it.product_id) {
        const [[p]] = await conn.query(
          `SELECT gst_rate FROM products WHERE id = ?`,
          [it.product_id]
        )
        it.gst_rate = Number(p?.gst_rate || 0)
      }
    }

    const computedItems = normalized.map(it => {
      const calc = calculateGSTLine({
        quantity: it.quantity,
        unitPrice: it.unit_price,
        gstRate: it.gst_rate,
        pricingMode: gstPricingMode,
        isInterState,
      })
      return { ...it, ...calc }
    })

    const totals = computeInvoiceTotals(computedItems)

    const now = new Date()
    const nextSeq = await getNextInvoiceSequence(conn, invSettings, now)
    const invoiceNumber = generateInvoiceNumber(invSettings, nextSeq, now)

    const [header] = await conn.query(
      `
      INSERT INTO invoices
      (
        invoice_number,
        invoice_sequence,
        source_type,
        source_id,
        lead_id,
        issue_date,
        status,
        billing_snapshot,
        shipping_snapshot,
        subtotal,
        cgst_total,
        sgst_total,
        igst_total,
        grand_total,
        notes
      )
      VALUES (?, ?, 'WORK_ORDER', ?, ?, CURDATE(), 'issued', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        invoiceNumber,
        nextSeq,
        workOrderId,
        leadId,
        billing ? JSON.stringify(billing) : null,
        shipping ? JSON.stringify(shipping) : null,
        totals.subtotal,
        totals.cgst_total,
        totals.sgst_total,
        totals.igst_total,
        totals.grand_total,
        wo.notes || null,
      ]
    )

    const invoiceId = header.insertId

    for (const it of computedItems) {
      await conn.query(
        `
        INSERT INTO invoice_items
        (
          invoice_id,
          product_id,
          description,
          quantity,
          unit_price,
          gst_rate,
          taxable_amount,
          cgst_amount,
          sgst_amount,
          igst_amount,
          line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          invoiceId,
          it.product_id,
          it.description,
          it.quantity,
          it.unit_price,
          it.gst_rate,
          it.taxable_amount,
          it.cgst_amount,
          it.sgst_amount,
          it.igst_amount,
          it.line_total,
        ]
      )
    }

    await conn.commit()
    conn.release()

    return res.status(201).json({
      message: 'Invoice created from Work Order',
      id: invoiceId,
      invoice_number: invoiceNumber,
      totals,
      already_existed: false,
    })
  } catch (err) {
    if (conn) {
      await conn.rollback()
      conn.release()
    }
    console.error('createInvoiceFromWorkOrder error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* ---------------------------------------------------------
   List invoices
   GET /invoices
--------------------------------------------------------- */
const getInvoices = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT 
        i.*,
        l.first_name,
        l.last_name,
        l.company_name
      FROM invoices i
      LEFT JOIN leads l ON l.id = i.lead_id
      ORDER BY i.id DESC
      `
    )
    return res.status(200).json(rows)
  } catch (err) {
    console.error('getInvoices error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* ---------------------------------------------------------
   Get invoice by id (with items)
   GET /invoices/:id
--------------------------------------------------------- */
const getInvoiceById = async (req, res) => {
  const { id } = req.params;

  try {
    // 🔥 JOIN LEAD
    const [rows] = await db.query(
      `
      SELECT 
        i.*,
        l.first_name,
        l.last_name,
        l.email,
        l.phone_number AS phone
      FROM invoices i
      LEFT JOIN leads l ON i.lead_id = l.id
      WHERE i.id = ?
      `,
      [id]
    );

    if (!rows.length)
      return res.status(404).json({ error: "Invoice not found" });

    const invoice = rows[0];

    // 🔥 Fetch items
    const [items] = await db.query(
      `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC`,
      [id]
    );

    // 🔥 Parse snapshots safely
    try {
      invoice.billing_snapshot =
        typeof invoice.billing_snapshot === "string"
          ? JSON.parse(invoice.billing_snapshot)
          : invoice.billing_snapshot;
    } catch {}

    try {
      invoice.shipping_snapshot =
        typeof invoice.shipping_snapshot === "string"
          ? JSON.parse(invoice.shipping_snapshot)
          : invoice.shipping_snapshot;
    } catch {}

    invoice.items = items || [];

    return res.status(200).json(invoice);
  } catch (err) {
    console.error("getInvoiceById error:", err);
    return res.status(500).json({ error: err.message });
  }
};
/* ---------------------------------------------------------
   Update invoice status
   PUT /invoices/:id/status
--------------------------------------------------------- */
const updateInvoiceStatus = async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  const allowed = ['draft', 'issued', 'paid', 'cancelled']
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  try {
    const [result] = await db.query(
      `UPDATE invoices SET status = ? WHERE id = ?`,
      [status, id]
    )
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Invoice not found' })
    }
    return res.status(200).json({ message: 'Invoice status updated', status })
  } catch (err) {
    console.error('updateInvoiceStatus error:', err)
    return res.status(500).json({ error: err.message })
  }
}

module.exports = {
  createInvoice,
  createInvoiceFromWorkOrder,
  getInvoices,
  getInvoiceById,
  updateInvoiceStatus,
}
