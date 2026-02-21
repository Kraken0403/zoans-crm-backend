const db = require('../config/db')

/* --------------------------------------------------
   Simple numbering: WO/{year}/{seq}
-------------------------------------------------- */
function generateWorkOrderNumber(sequence) {
  const year = new Date().getFullYear()
  return `WO/${year}/${String(sequence).padStart(4, '0')}`
}

/* --------------------------------------------------
   INTERNAL CREATION FUNCTION
-------------------------------------------------- */
async function _createWorkOrderForQuotation(connection, quotationId) {

  /* 1️⃣ Load quotation + FULL lead data */
  const [quotationRows] = await connection.query(
    `
    SELECT 
      q.*, 
      l.first_name,
      l.last_name,
      l.company_name,
      l.phone_number,
      l.email,
      l.gst_number
    FROM quotations q
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE q.id = ?
    `,
    [quotationId]
  )

  const quotation = quotationRows[0]

  if (!quotation)
    throw new Error('Quotation not found for work order creation')

  if (quotation.status !== 'approved')
    throw new Error('Work order can only be created from approved quotations')

  /* 2️⃣ Prevent duplicates */
  const [existingRows] = await connection.query(
    `SELECT id FROM work_orders WHERE quotation_id = ? LIMIT 1`,
    [quotationId]
  )

  if (existingRows.length) {
    return {
      id: existingRows[0].id,
      work_order_number: null,
      existing: true
    }
  }

  /* 3️⃣ Load quotation items */
  const [items] = await connection.query(
    `SELECT * FROM quotation_items WHERE quotation_id = ?`,
    [quotationId]
  )

  if (!items.length)
    throw new Error('Quotation has no items')

  /* 4️⃣ Generate sequence */
  const [seqRows] = await connection.query(
    `SELECT MAX(work_order_sequence) AS maxSeq FROM work_orders`
  )

  const nextSeq = (seqRows[0]?.maxSeq || 0) + 1
  const work_order_number = generateWorkOrderNumber(nextSeq)

  /* 5️⃣ Build immutable snapshot */
  const billingSnapshot = {
    name: `${quotation.first_name || ''} ${quotation.last_name || ''}`.trim(),
    company: quotation.company_name || '',
    phone: quotation.phone_number || '',
    email: quotation.email || '',
    gst: quotation.gst_number || ''
  }

  const shippingSnapshot = billingSnapshot

/* 6️⃣ Insert header with snapshot + event details */
const [header] = await connection.query(
  `
  INSERT INTO work_orders
  (
    quotation_id,
    lead_id,
    quotation_mode,
    pax,
    event_name,
    event_date,
    event_time,
    event_location,
    work_order_number,
    work_order_sequence,
    status,
    issue_date,
    customer_name,
    customer_gst,
    notes,
    order_source,
    shipping_snapshot,
    billing_snapshot,
    subtotal,
    grand_total,
    total_amount
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', CURDATE(), ?, ?, ?, 'CRM', ?, ?, 0, 0, 0)
  `,
  [
    quotation.id,
    quotation.lead_id || null,

    quotation.quotation_mode || null,
    quotation.pax || null,
    quotation.event_name || null,
    quotation.event_date || null,
    quotation.event_time || null,
    quotation.event_location || null,

    work_order_number,
    nextSeq,

    billingSnapshot.name,
    billingSnapshot.gst,
    quotation.notes || null,
    JSON.stringify(shippingSnapshot),
    JSON.stringify(billingSnapshot)
  ]
)



  const workOrderId = header.insertId

  /* 7️⃣ Insert items */
  let computedTotal = 0

  for (const it of items) {

    const baseQty = Number(it.quantity) || 0
    const pax = Number(quotation.pax) || 1

    const effectiveQty =
      quotation.quotation_mode === 'CATERING'
        ? baseQty * pax
        : baseQty

    const unitPrice = Number(it.selling_price) || 0
    const discount = Number(it.discount) || 0
    const tax = Number(it.tax) || 0

    const lineTotal =
      effectiveQty * unitPrice - discount + tax

    computedTotal += lineTotal

    await connection.query(
      `
      INSERT INTO work_order_items
      (
        work_order_id,
        product_id,
        product_name,
        variant_id,
        variant_name,
        description,
        quantity,
        unit_price,
        discount,
        tax
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        workOrderId,
        it.product_id,
        it.product_name || null,
        it.variant_id || null,
        it.variant_name || null,
        it.product_name || null,
        effectiveQty,
        unitPrice,
        discount,
        tax
      ]
    )
    
  }

  /* 8️⃣ Update totals */
  await connection.query(
    `
    UPDATE work_orders
    SET subtotal = ?, 
        grand_total = ?, 
        total_amount = ?
    WHERE id = ?
    `,
    [computedTotal, computedTotal, computedTotal, workOrderId]
  )

  /* 9️⃣ Lock quotation */
  await connection.query(
    `
    UPDATE quotations
    SET status = 'converted',
        is_locked = 1
    WHERE id = ?
    `,
    [quotationId]
  )

  return {
    id: workOrderId,
    work_order_number,
    existing: false
  }
}

/* --------------------------------------------------
   MANUAL CREATE FROM QUOTATION
-------------------------------------------------- */
const createFromQuotation = async (req, res) => {
  const { quotationId } = req.params
  const connection = await db.getConnection()

  try {
    await connection.beginTransaction()

    const wo = await _createWorkOrderForQuotation(connection, quotationId)

    await connection.commit()
    connection.release()

    return res.status(201).json({
      message: wo.existing
        ? 'Work order already existed for this quotation'
        : 'Work order created from quotation',
      work_order_id: wo.id,
      work_order_number: wo.work_order_number,
      already_existed: wo.existing
    })

  } catch (error) {
    console.error('createFromQuotation error:', error)
    await connection.rollback()
    connection.release()
    return res.status(500).json({ error: error.message })
  }
}

/* --------------------------------------------------
   GET ALL WORK ORDERS
-------------------------------------------------- */
const getWorkOrders = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT 
        wo.id,
        wo.work_order_number,
        wo.issue_date,
        wo.customer_name,
        wo.total_amount,
        wo.status,
        q.quotation_number
      FROM work_orders wo
      LEFT JOIN quotations q ON wo.quotation_id = q.id
      ORDER BY wo.id DESC
      `
    )

    return res.status(200).json({ workOrders: rows })

  } catch (err) {
    console.error('getWorkOrders error:', err)
    return res.status(500).json({
      error: 'Failed to fetch work orders',
      details: err.message
    })
  }
}

/* --------------------------------------------------
   GET WORK ORDER BY ID
-------------------------------------------------- */
const getWorkOrderById = async (req, res) => {
  try {
    const { id } = req.params

    const [rows] = await db.query(
      `
      SELECT 
        wo.*,
        q.quotation_number,
        q.version,
        q.parent_id,
        q.total_amount AS quotation_total
      FROM work_orders wo
      LEFT JOIN quotations q ON wo.quotation_id = q.id
      WHERE wo.id = ?
      `,
      [id]
    )

    if (!rows.length)
      return res.status(404).json({ error: 'Work order not found' })

    const wo = rows[0]

    /* 🔥 Parse snapshot instead of joining leads */
    if (wo.billing_snapshot) {
      try {
    
        const billing =
          typeof wo.billing_snapshot === 'string'
            ? JSON.parse(wo.billing_snapshot)
            : wo.billing_snapshot   // already object
    
        wo.first_name = billing?.name || ''
        wo.company_name = billing?.company || ''
        wo.phone_number = billing?.phone || ''
        wo.email = billing?.email || ''
        wo.gst_number = billing?.gst || ''
    
      } catch (e) {
        console.error('Snapshot parse error:', e)
      }
    }
    
    

    const [items] = await db.query(
      `
      SELECT woi.*, p.name AS product_name
      FROM work_order_items woi
      LEFT JOIN products p ON woi.product_id = p.id
      WHERE woi.work_order_id = ?
      `,
      [id]
    )

    wo.items = items || []

    return res.status(200).json(wo)

  } catch (err) {
    console.error('getWorkOrderById error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* --------------------------------------------------
   UPDATE WORK ORDER STATUS
-------------------------------------------------- */
const updateWorkOrderStatus = async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!status)
      return res.status(400).json({ error: 'Status is required' })

    const [result] = await db.query(
      `UPDATE work_orders SET status = ? WHERE id = ?`,
      [status, id]
    )

    if (!result.affectedRows)
      return res.status(404).json({ error: 'Work order not found' })

    return res.status(200).json({
      message: 'Work order status updated'
    })

  } catch (err) {
    console.error('updateWorkOrderStatus error:', err)
    return res.status(500).json({
      error: 'Failed to update status',
      details: err.message
    })
  }
}

module.exports = {
  createFromQuotation,
  getWorkOrders,
  getWorkOrderById,
  updateWorkOrderStatus,
  _createWorkOrderForQuotation
}
