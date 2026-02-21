const db = require('../config/db');
const { getRootQuotationId } = require('../utils/quotationUtils');

// ---------------------------------------------------------
// Helper: Generate Quotation Number
// ---------------------------------------------------------
// Normalize incoming dates (accepts '2025-12-02' or '2025-12-02T18:30:00.000Z')
const toMySQLDate = (d) => (d ? d.substring(0, 10) : null)

function generateQuotationNumber(settings, sequence) {
  const year = new Date().getFullYear()
  const month = String(new Date().getMonth() + 1).padStart(2, '0')

  return settings.number_format
    .replace('{prefix}', settings.prefix)
    .replace('{year}', year)
    .replace('{month}', month)
    .replace('{seq}', String(sequence).padStart(4, '0'))
}

// ---------------------------------------------------------
// INSERT QUOTATION ITEMS (FULL SNAPSHOT)
// ---------------------------------------------------------

async function insertQuotationItemsSnapshot(connection, quotationId, items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Invoice items are required')
  }

  for (const item of items) {
    const {
      product_id,
      variant_id = null,

      quantity,
      unit_price, // frontend sends unit_price
      discount = 0,
      gst_rate = 0,

      // optional overrides from frontend
      cost_price,
      cost_price_unit,
      cost_price_qty,
      cost_pricing_mode,
      cost_discount_percent,
    } = item

    const pid = Number(product_id || 0)
    const qty = Number(quantity || 0)
    const price = Number(unit_price || 0)
    const disc = Number(discount || 0)

    if (!pid) throw new Error('Invalid quotation item: product_id missing')
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quotation item: quantity invalid')
    if (!Number.isFinite(price) || price < 0) throw new Error('Invalid quotation item: unit_price invalid')

    // 1) Fetch product snapshot (source of truth)
    const [[product]] = await connection.query(
      `
      SELECT
        p.name AS product_name,
        p.sku,
        p.cost_price,
        p.cost_price_unit,
        p.cost_price_qty,
        p.cost_pricing_mode,
        p.cost_discount_percent,
        p.gst_rate,
        p.hsn_sac
      FROM products p
      WHERE p.id = ?
      LIMIT 1
      `,
      [pid]
    )

    if (!product) throw new Error(`Product not found for product_id=${pid}`)

    // 2) Resolve cost fields (frontend override > product snapshot > fallback)
    const resolvedCostPrice = Number(
      (cost_price ?? product.cost_price ?? 0)
    )
    const resolvedCostPriceQty = Number(
      (cost_price_qty ?? product.cost_price_qty ?? 1)
    )
    const resolvedCostDiscountPercent = Number(
      (cost_discount_percent ?? product.cost_discount_percent ?? 0)
    )
    const resolvedCostPricingMode =
      (cost_pricing_mode ?? product.cost_pricing_mode ?? 'absolute')

    const resolvedCostPriceUnit =
      (cost_price_unit ?? product.cost_price_unit ?? 'unit')

    // 3) Resolve GST + HSN
    const resolvedGstRate = Number(product.gst_rate ?? gst_rate ?? 0)
    const resolvedHsn = product.hsn_sac ?? null

    // 4) Insert snapshot row
    // IMPORTANT: Do NOT insert `line_total` because it is STORED GENERATED in your table.
    await connection.query(
      `
      INSERT INTO quotation_items (
        quotation_id,
        product_id,
        variant_id,
        quantity,

        selling_price,
        selling_price_unit,
        selling_price_qty,

        discount,
        tax,

        gst_rate,
        hsn_sac,

        product_name,
        variant_sku,
        attributes_json,
        packaging_json,

        cost_price,
        cost_price_unit,
        cost_price_qty,
        cost_pricing_mode,
        cost_discount_percent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        quotationId,
        pid,
        variant_id,

        qty,

        price,
        'unit',
        1,

        Math.max(0, disc),
        0, // tax is separate column; keep 0 unless you use it

        resolvedGstRate,
        resolvedHsn,

        product.product_name || product.product_name === '' ? product.product_name : product.product_name, // safe
        product.sku ?? null,
        JSON.stringify(item.attributes_json ?? {}),
        JSON.stringify(item.packaging_json ?? {}),

        Number.isFinite(resolvedCostPrice) ? resolvedCostPrice : 0,
        resolvedCostPriceUnit,
        Number.isFinite(resolvedCostPriceQty) && resolvedCostPriceQty > 0 ? resolvedCostPriceQty : 1,
        resolvedCostPricingMode === 'percentage' ? 'percentage' : 'absolute',
        Number.isFinite(resolvedCostDiscountPercent) ? resolvedCostDiscountPercent : 0,
      ]
    )
  }
}



// ---------------------------------------------------------
// CREATE QUOTATION
// ---------------------------------------------------------
const createQuotation = async (req, res) => {
  const {
    lead_id,
    quotation_date,
    valid_until,
    notes,
    items,
    parent_id = null,

    pax = null,
    event_name = null,
    event_date = null,
    event_time = null,
    event_location = null,

    quotation_discount_type = null,
    quotation_discount_value = 0
  } = req.body;

  if (!lead_id || !quotation_date || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    /* SETTINGS */
    const [[settings]] = await connection.query(
      `SELECT * FROM quotation_settings LIMIT 1`
    );

    const quotationMode = settings?.quotation_mode || 'GENERAL';
    const gstPricingMode = settings?.gst_pricing_mode || 'EXCLUSIVE';

    if (quotationMode === 'CATERING' && (!pax || pax < 1)) {
      throw new Error('PAX required for catering');
    }

    /* SEQUENCE */
    const [[seqRow]] = await connection.query(
      `SELECT MAX(quotation_sequence) AS maxSeq FROM quotations`
    );

    const nextSeq = seqRow?.maxSeq
      ? seqRow.maxSeq + 1
      : settings.sequence_start;

    const quotation_number = generateQuotationNumber(settings, nextSeq);

    /* INSERT HEADER */
    const [header] = await connection.query(
      `
      INSERT INTO quotations (
        lead_id, quotation_date, valid_until, notes,
        status, quotation_number, quotation_sequence,
        quotation_mode, pax,
        event_name, event_date, event_time, event_location,
        quotation_discount_type, quotation_discount_value
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        lead_id,
        toMySQLDate(quotation_date),
        toMySQLDate(valid_until),
        notes,
        quotation_number,
        nextSeq,
        quotationMode,
        pax,
        event_name,
        toMySQLDate(event_date),
        event_time,
        event_location,
        quotation_discount_type,
        quotation_discount_value
      ]
    );

    await insertQuotationItemsSnapshot(connection, header.insertId, items);

    /* TOTAL CALCULATION */
    const [[totals]] = await connection.query(
      `
      SELECT
        IFNULL(SUM(qi.selling_price * qi.quantity),0) AS subtotal,
        IFNULL(SUM(qi.discount),0) AS item_discount_total,
        IFNULL(SUM(qi.line_total),0) AS base_amount,
        IFNULL(SUM(qi.line_total * (qi.gst_rate/100)),0) AS total_tax
      FROM quotation_items qi
      WHERE qi.quotation_id = ?
      `,
      [header.insertId]
    );

    const baseAmount = Number(totals.base_amount || 0);

    let quotation_discount_amount = 0;

    if (quotation_discount_type === 'PERCENT') {
      quotation_discount_amount =
        (baseAmount * quotation_discount_value) / 100;
    }

    if (quotation_discount_type === 'FLAT') {
      quotation_discount_amount = quotation_discount_value;
    }

    const total_discount =
      Number(totals.item_discount_total) + quotation_discount_amount;

    const total_amount =
      baseAmount - quotation_discount_amount;

    await connection.query(
      `
      UPDATE quotations
      SET subtotal=?, total_discount=?, total_tax=?, total_amount=?, quotation_discount_amount=?
      WHERE id=?
      `,
      [
        totals.subtotal,
        total_discount,
        totals.total_tax,
        total_amount,
        quotation_discount_amount,
        header.insertId
      ]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({
      id: header.insertId,
      quotation_number,
      totals: {
        subtotal: totals.subtotal,
        total_discount,
        tax: totals.total_tax,
        total: total_amount
      }
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('createQuotation error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------
// UPDATE QUOTATION
// ---------------------------------------------------------

const updateQuotation = async (req, res) => {
  const { id } = req.params
  console.log("UPDATE HEADER HIT")
  console.log("BODY RECEIVED:", req.body)

  const {
    lead_id,
    quotation_date,
    valid_until,
    notes,
    pax,
    event_name,
    event_date,
    event_time,
    event_location,
    quotation_discount_type,
    quotation_discount_value
  } = req.body

  const safeDate = (d) => {
    if (!d) return null
    const s = String(d).trim()
    if (!s) return null
    return s.substring(0, 10)
  }

  let connection

  try {
    connection = await db.getConnection()
    await connection.beginTransaction()

    // 1️⃣ Check quotation exists
    const [[existing]] = await connection.query(
      `SELECT * FROM quotations WHERE id = ?`,
      [id]
    )

    if (!existing) {
      await connection.rollback()
      connection.release()
      return res.status(404).json({ error: "Quotation not found" })
    }

    if (existing.is_locked) {
      await connection.rollback()
      connection.release()
      return res.status(403).json({ error: "Locked quotations cannot be edited" })
    }

    // 2️⃣ Dynamically build UPDATE
    const fields = []
    const values = []

    if (lead_id !== undefined) {
      fields.push("lead_id = ?")
      values.push(lead_id)
    }

    if (quotation_date !== undefined) {
      fields.push("quotation_date = ?")
      values.push(safeDate(quotation_date))
    }

    if (valid_until !== undefined) {
      fields.push("valid_until = ?")
      values.push(safeDate(valid_until))
    }

    if (notes !== undefined) {
      fields.push("notes = ?")
      values.push(notes)
    }

    if (pax !== undefined) {
      fields.push("pax = ?")
      values.push(pax)
    }

    if (event_name !== undefined) {
      fields.push("event_name = ?")
      values.push(event_name)
    }

    if (event_date !== undefined) {
      fields.push("event_date = ?")
      values.push(safeDate(event_date))
    }

    if (event_time !== undefined) {
      fields.push("event_time = ?")
      values.push(event_time)
    }

    if (event_location !== undefined) {
      fields.push("event_location = ?")
      values.push(event_location)
    }

    if (quotation_discount_type !== undefined) {
      fields.push("quotation_discount_type = ?")
      values.push(quotation_discount_type)
    }

    if (quotation_discount_value !== undefined) {
      fields.push("quotation_discount_value = ?")
      values.push(Number(quotation_discount_value))
    }

    if (fields.length > 0) {
      values.push(id)

      const [result] = await connection.query(
        `UPDATE quotations SET ${fields.join(", ")} WHERE id = ?`,
        values
      )

      if (!result.affectedRows) {
        throw new Error("Quotation update failed")
      }
    }

    // 3️⃣ Fetch settings for tax mode
    const [[settings]] = await connection.query(
      `SELECT * FROM quotation_settings LIMIT 1`
    )

    const gstPricingMode = settings?.gst_pricing_mode || "EXCLUSIVE"

    // 4️⃣ Recalculate totals
    const [[totalsRaw]] = await connection.query(
      `
      SELECT
        IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS paxFactor,

        IFNULL(SUM(qi.selling_price * qi.quantity), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS subtotal,

        IFNULL(SUM(qi.discount), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS item_discount_total,

        IFNULL(SUM(qi.line_total), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS base_amount,

        IFNULL(SUM(
          CASE
            WHEN ? = 'INCLUSIVE'
            THEN
              (qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
              -
              ((qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
               / (1 + qi.gst_rate / 100))
            ELSE
              (qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
              * (qi.gst_rate / 100)
          END
        ), 0) AS total_tax
      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id
      WHERE qi.quotation_id = ?
      `,
      [gstPricingMode, id]
    )

    const subtotal = Number(totalsRaw.subtotal || 0)
    const itemDiscount = Number(totalsRaw.item_discount_total || 0)
    const baseAmount = Number(totalsRaw.base_amount || 0)
    const totalTax = Number(totalsRaw.total_tax || 0)

    // 5️⃣ Apply quotation-level discount
    const discountType = quotation_discount_type ?? existing.quotation_discount_type
    const discountValue = Number(
      quotation_discount_value ?? existing.quotation_discount_value ?? 0
    )

    let quotationDiscountAmount = 0

    if (discountType === "PERCENT") {
      quotationDiscountAmount = (baseAmount * discountValue) / 100
    } else if (discountType === "FLAT") {
      quotationDiscountAmount = discountValue
    }

    quotationDiscountAmount = Math.max(0, quotationDiscountAmount)

    const totalDiscount = itemDiscount + quotationDiscountAmount
    const totalAmount = Math.max(0, baseAmount - quotationDiscountAmount)

    // 6️⃣ Update totals snapshot
    await connection.query(
      `
      UPDATE quotations
      SET
        subtotal = ?,
        total_discount = ?,
        total_tax = ?,
        total_amount = ?,
        quotation_discount_amount = ?
      WHERE id = ?
      `,
      [
        subtotal,
        totalDiscount,
        totalTax,
        totalAmount,
        quotationDiscountAmount,
        id
      ]
    )

    await connection.commit()
    connection.release()

    return res.status(200).json({
      message: "Quotation updated successfully",
      totals: {
        subtotal,
        item_discount: itemDiscount,
        quotation_discount: quotationDiscountAmount,
        total_discount: totalDiscount,
        tax: totalTax,
        total: totalAmount
      }
    })

  } catch (error) {
    console.error("❌ updateQuotation failed:", error)
    if (connection) {
      await connection.rollback()
      connection.release()
    }
    return res.status(500).json({ error: error.message })
  }
}


// ---------------------------------------------------------
// OTHER METHODS (UNCHANGED LOGIC)
// ---------------------------------------------------------
const getQuotations = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        q.*,
        l.first_name,
        l.last_name
      FROM quotations q
      LEFT JOIN leads l ON q.lead_id = l.id
      ORDER BY q.id DESC
      `
    );

    return res.json(rows);

  } catch (err) {
    console.error('getQuotations error:', err);
    return res.status(500).json({ error: err.message });
  }
};

const getQuotationById = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM quotations WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Quotation not found' });
    }

    const quotation = rows[0];

    const [items] = await db.query(
      `SELECT * FROM quotation_items WHERE quotation_id = ?`,
      [id]
    );

    quotation.items = items;

    return res.json(quotation);

  } catch (err) {
    console.error('getQuotationById error:', err);
    return res.status(500).json({ error: err.message });
  }
};






// ---------------------------------------------------------
// DELETE QUOTATION
// ---------------------------------------------------------
const deleteQuotation = async (req, res) => {
  const { id } = req.params;

  let conn;

  try {
    // 1️⃣ Check if quotation exists + locked
    const [rows] = await db.query(
      `SELECT is_locked FROM quotations WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Quotation not found' });
    }

    if (rows[0].is_locked) {
      return res.status(403).json({
        error: 'Approved quotations cannot be deleted'
      });
    }

    // 2️⃣ Start transaction
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 3️⃣ Delete items
    await conn.query(
      `DELETE FROM quotation_items WHERE quotation_id = ?`,
      [id]
    );

    // 4️⃣ Delete quotation
    await conn.query(
      `DELETE FROM quotations WHERE id = ?`,
      [id]
    );

    // 5️⃣ Commit
    await conn.commit();
    conn.release();

    return res.status(200).json({
      message: 'Quotation deleted successfully'
    });

  } catch (err) {
    if (conn) {
      await conn.rollback();
      conn.release();
    }

    console.error('deleteQuotation error:', err);

    return res.status(500).json({
      error: err.message
    });
  }
};


// ---------------------------------------------------------
// UPDATE STATUS
// ---------------------------------------------------------
const updateQuotationStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id FROM quotations WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Quotation not found' });
    }

    if (status === 'approved') {
      const rootId = await getRootQuotationId(conn, id);

      await conn.query(
        `UPDATE quotations 
         SET status = 'rejected', is_locked = 1
         WHERE id = ? OR parent_id = ?`,
        [rootId, rootId]
      );

      await conn.query(
        `UPDATE quotations 
         SET status = 'approved', is_locked = 1
         WHERE id = ?`,
        [id]
      );

    } else {
      await conn.query(
        `UPDATE quotations SET status = ? WHERE id = ?`,
        [status, id]
      );
    }

    await conn.commit();
    conn.release();

    return res.json({
      success: true,
      message: 'Status updated successfully'
    });

  } catch (err) {
    if (conn) {
      await conn.rollback();
      conn.release();
    }

    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};




// ---------------------------------------------------------
// UPDATE QUOTATION ITEMS (delete + reinsert + recalc total)
// ---------------------------------------------------------
const updateQuotationItems = async (req, res) => {
  const { id } = req.params
  const { items } = req.body

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' })
  }

  let connection
  try {
    connection = await db.getConnection()
    await connection.beginTransaction()

    // 1) safety
    const [[quotation]] = await connection.query(
      `SELECT status, is_locked, quotation_mode, pax, quotation_discount_type, quotation_discount_value
       FROM quotations WHERE id = ?`,
      [id]
    )
    if (!quotation) throw new Error('Quotation not found')
    if (quotation.is_locked) throw new Error('Locked quotations cannot be edited')

    // 2) settings
    const [[settings]] = await connection.query(
      `SELECT * FROM quotation_settings LIMIT 1`
    )
    const gstPricingMode = settings?.gst_pricing_mode || 'EXCLUSIVE'

    // 3) delete + insert items
    await connection.query(`DELETE FROM quotation_items WHERE quotation_id = ?`, [id])
    await insertQuotationItemsSnapshot(connection, id, items)

    // 4) totals
    const [[t]] = await connection.query(
      `
      SELECT
        IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS paxFactor,

        IFNULL(SUM(qi.selling_price * qi.quantity), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS subtotal,

        IFNULL(SUM(qi.discount), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS item_discount_total,

        IFNULL(SUM(qi.line_total), 0)
          * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS base_amount,

        IFNULL(SUM(
          CASE
            WHEN ? = 'INCLUSIVE'
            THEN
              (qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
              -
              ((qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
               / (1 + qi.gst_rate / 100))
            ELSE
              (qi.line_total * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1))
              * (qi.gst_rate / 100)
          END
        ), 0) AS total_tax
      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id
      WHERE qi.quotation_id = ?
      `,
      [gstPricingMode, id]
    )

    const subtotal = Number(t.subtotal || 0)
    const itemDiscountTotal = Number(t.item_discount_total || 0)
    const baseAmount = Number(t.base_amount || 0)
    const totalTax = Number(t.total_tax || 0)

    // 5) quotation-level discount from header
    const discountType = quotation.quotation_discount_type
    const discountValue = Number(quotation.quotation_discount_value || 0)

    let quotation_discount_amount = 0
    if (discountType === 'PERCENT') {
      quotation_discount_amount = (baseAmount * discountValue) / 100
    } else if (discountType === 'FLAT') {
      quotation_discount_amount = discountValue
    }

    quotation_discount_amount = Math.max(0, quotation_discount_amount)

    const total_discount = itemDiscountTotal + quotation_discount_amount
    const total_amount = Math.max(0, baseAmount - quotation_discount_amount)

    // 6) update quotation header totals
    await connection.query(
      `
      UPDATE quotations
      SET
        subtotal = ?,
        total_discount = ?,
        total_tax = ?,
        total_amount = ?,
        quotation_discount_amount = ?
      WHERE id = ?
      `,
      [
        subtotal,
        total_discount,
        totalTax,
        total_amount,
        quotation_discount_amount,
        id
      ]
    )

    await connection.commit()
    connection.release()

    return res.status(200).json({
      message: 'Quotation items updated successfully',
      totals: {
        subtotal,
        item_discount_total: itemDiscountTotal,
        quotation_discount_amount,
        total_discount,
        total_tax: totalTax,
        total: total_amount
      }
    })
  } catch (error) {
    console.error('❌ updateQuotationItems failed:', error)
    if (connection) {
      await connection.rollback()
      connection.release()
    }
    return res.status(500).json({ error: error.message })
  }
}



module.exports = {
  createQuotation,
  getQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  updateQuotationStatus,
  updateQuotationItems
};
