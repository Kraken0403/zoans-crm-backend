// controllers/workOrderController.js
const db = require('../config/db');

// Simple numbering: WO/{year}/{seq}
function generateWorkOrderNumber(sequence) {
  const year = new Date().getFullYear();
  return `WO/${year}/${String(sequence).padStart(4, '0')}`;
}

/**
 * INTERNAL helper – creates a work order for a given quotation inside an existing connection/tx.
 * Used by:
 *  - Auto creation when quotation becomes "approved"
 *  - Manual creation via POST /from-quotation
 *
 * @param {object} connection - MySQL connection (from db.getConnection)
 * @param {number} quotationId
 * @returns {Promise<{id, work_order_number, existing: boolean}>}
 */
 async function _createWorkOrderForQuotation(connection, quotationId) {
  // 1) Load quotation + lead
  const quotation = await new Promise((resolve, reject) => {
    connection.query(
      `
      SELECT q.*, l.first_name, l.last_name
      FROM quotations q
      LEFT JOIN leads l ON q.lead_id = l.id
      WHERE q.id = ?
      `,
      [quotationId],
      (err, rows) => (err ? reject(err) : resolve(rows[0]))
    )
  })

  if (!quotation) {
    throw new Error('Quotation not found for work order creation')
  }

  // ❌ BLOCK NON-APPROVED QUOTATIONS
  if (quotation.status !== 'approved') {
    throw new Error('Work order can only be created from approved quotations')
  }

  // 2) Prevent duplicates
  const existing = await new Promise((resolve, reject) => {
    connection.query(
      `SELECT id FROM work_orders WHERE quotation_id = ? LIMIT 1`,
      [quotationId],
      (err, rows) => (err ? reject(err) : resolve(rows[0]))
    )
  })

  if (existing) {
    return { id: existing.id, work_order_number: null, existing: true }
  }

  // 3) Load quotation items
  const items = await new Promise((resolve, reject) => {
    connection.query(
      `SELECT * FROM quotation_items WHERE quotation_id = ?`,
      [quotationId],
      (err, rows) => (err ? reject(err) : resolve(rows))
    )
  })

  if (!items.length) {
    throw new Error('Quotation has no items')
  }

  // 4) Generate sequence
  const currentSeq = await new Promise((resolve, reject) => {
    connection.query(
      `SELECT MAX(work_order_sequence) AS maxSeq FROM work_orders`,
      (err, rows) => (err ? reject(err) : resolve(rows[0]?.maxSeq || 0))
    )
  })

  const nextSeq = currentSeq + 1
  const work_order_number = generateWorkOrderNumber(nextSeq)

  // 5) Insert work order header
  const header = await new Promise((resolve, reject) => {
    connection.query(
      `
      INSERT INTO work_orders
      (
        quotation_id,
        work_order_number,
        work_order_sequence,
        status,
        issue_date,
        customer_name,
        notes,
        total_amount
      )
      VALUES (?, ?, ?, 'issued', CURDATE(), ?, ?, 0)
      `,
      [
        quotation.id,
        work_order_number,
        nextSeq,
        `${quotation.first_name || ''} ${quotation.last_name || ''}`.trim(),
        quotation.notes || null
      ],
      (err, result) => (err ? reject(err) : resolve(result))
    )
  })

  const workOrderId = header.insertId

  // 6) Insert items (DO NOT TOUCH line_total)
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

    await new Promise((resolve, reject) => {
      connection.query(
        `
        INSERT INTO work_order_items
        (
          work_order_id,
          product_id,
          variant_id,
          description,
          quantity,
          unit_price,
          discount,
          tax
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          workOrderId,
          it.product_id,
          it.variant_id || null,
          it.product_name || null,
          effectiveQty,
          unitPrice,
          discount,
          tax
        ],
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  // 7) Update work order total
  await new Promise((resolve, reject) => {
    connection.query(
      `UPDATE work_orders SET total_amount = ? WHERE id = ?`,
      [computedTotal, workOrderId],
      (err) => (err ? reject(err) : resolve())
    )
  })

  // 8) Lock & convert quotation
  await new Promise((resolve, reject) => {
    connection.query(
      `
      UPDATE quotations
      SET status = 'converted',
          is_locked = 1
      WHERE id = ?
      `,
      [quotationId],
      (err) => (err ? reject(err) : resolve())
    )
  })

  return {
    id: workOrderId,
    work_order_number,
    existing: false
  }
}

// ---------------------------------------------------------------------------
// PUBLIC CONTROLLER METHODS
// ---------------------------------------------------------------------------

// Manual: POST /api/work-orders/from-quotation/:quotationId
const createFromQuotation = (req, res) => {
  const { quotationId } = req.params;

  db.getConnection((err, conn) => {
    if (err) {
      return res
        .status(500)
        .json({ error: 'DB connection failed', details: err.message });
    }

    conn.beginTransaction(async (txErr) => {
      if (txErr) {
        conn.release();
        return res
          .status(500)
          .json({ error: 'Transaction start failed', details: txErr.message });
      }

      try {
        const wo = await _createWorkOrderForQuotation(conn, quotationId);

        conn.commit((commitErr) => {
          conn.release();
          if (commitErr) {
            return res
              .status(500)
              .json({ error: 'Commit failed', details: commitErr.message });
          }

          res.status(201).json({
            message: wo.existing
              ? 'Work order already existed for this quotation'
              : 'Work order created from quotation',
            work_order_id: wo.id,
            work_order_number: wo.work_order_number,
            already_existed: wo.existing
          });
        });
      } catch (error) {
        console.error('🔥 Error in createFromQuotation:', error);
        conn.rollback(() => {
          conn.release();
          res.status(500).json({ error: error.message });
        });
      }
    });
  });
};

// GET /api/work-orders
const getWorkOrders = (req, res) => {
  const sql = `
    SELECT wo.*, q.quotation_number
    FROM work_orders wo
    LEFT JOIN quotations q ON wo.quotation_id = q.id
    ORDER BY wo.id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to fetch work orders',
        details: err.message
      });
    }

    res.status(200).json({ workOrders: rows });
  });
};

// GET /api/work-orders/:id
const getWorkOrderById = (req, res) => {
  const { id } = req.params;

  const headerSql = `
    SELECT
      wo.*,
      q.quotation_number,
      q.version,
      q.parent_id,
      q.total_amount AS quotation_total,
      q.notes AS quotation_notes,
      q.quotation_date,
      q.valid_until,
      l.first_name,
      l.last_name,
      l.company_name,
      l.email,
      l.phone_number,
      l.gst_number,
      l.lead_status,
      l.priority,
      l.notes AS lead_notes
    FROM work_orders wo
    LEFT JOIN quotations q ON wo.quotation_id = q.id
    LEFT JOIN leads l ON q.lead_id = l.id
    WHERE wo.id = ?
  `;

  db.query(headerSql, [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!rows.length) {
      return res.status(404).json({ error: 'Work order not found' });
    }

    const wo = rows[0];

    const itemsSql = `
      SELECT woi.*, p.name AS product_name
      FROM work_order_items woi
      LEFT JOIN products p ON woi.product_id = p.id
      WHERE woi.work_order_id = ?
    `;

    db.query(itemsSql, [id], (err2, items) => {
      if (err2) {
        return res.status(500).json({ error: err2.message });
      }

      wo.items = items || [];
      res.status(200).json(wo);
    });
  });
};

// PUT /api/work-orders/:id/status
const updateWorkOrderStatus = (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  db.query(
    `UPDATE work_orders SET status = ? WHERE id = ?`,
    [status, id],
    (err) => {
      if (err) {
        return res.status(500).json({
          error: 'Failed to update status',
          details: err.message
        });
      }

      res.status(200).json({ message: 'Work order status updated' });
    }
  );
};

module.exports = {
  createFromQuotation,
  getWorkOrders,
  getWorkOrderById,
  updateWorkOrderStatus,
  _createWorkOrderForQuotation
};
