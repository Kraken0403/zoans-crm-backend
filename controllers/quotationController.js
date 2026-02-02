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
  for (const item of items) {
    const {
      product_id,
      variant_id = null,
      quantity,
      unit_price,
      discount = 0,
      gst_rate = 0,
    
      // 👇 SNAPSHOT COST FIELDS (THIS IS THE FIX)
      cost_price,
      cost_price_unit,
      cost_price_qty,
      cost_pricing_mode,
      cost_discount_percent
    } = item

    const qty = Number(quantity)
    const price = Number(unit_price)
    const disc = Number(discount)

    if (!product_id || isNaN(qty) || isNaN(price)) {
      throw new Error('Invalid quotation item payload')
    }

    const product = await new Promise((resolve, reject) => {
      connection.query(
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
        `,
        [product_id],
        (err, rows) => (err ? reject(err) : resolve(rows[0]))
      )
    })

    if (!product) throw new Error('Error')

    await new Promise((resolve, reject) => {
      connection.query(
        `INSERT INTO quotation_items (
          quotation_id, product_id, variant_id, quantity,

          cost_price, cost_price_unit, cost_price_qty,
          cost_pricing_mode, cost_discount_percent,

          selling_price, selling_price_unit, selling_price_qty,

          discount, tax,

          gst_rate, hsn_sac,

          product_name, variant_sku,
          attributes_json, packaging_json
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?
        )`,
        [
          quotationId,
          product_id,
          variant_id,
          qty,

          cost_price ?? product.cost_price ?? 0,
          cost_price_unit ?? product.cost_price_unit ?? 'unit',
          cost_price_qty ?? product.cost_price_qty ?? 1,
          cost_pricing_mode ?? product.cost_pricing_mode ?? 'absolute',
          cost_discount_percent ?? product.cost_discount_percent ?? 0,

          price,
          'unit',
          1,

          disc,
          0,

          product.gst_rate || gst_rate || 0,
          product.hsn_sac || null,

          product.product_name,
          product.sku || null,
          JSON.stringify({}),
          JSON.stringify({})
        ],
        (err) => {
          if (err) {
            console.error('❌ SQL INSERT ERROR:', err.sqlMessage)
            return reject(err)
          }
          resolve()
        }
        
      )
    })
  }
}

// ---------------------------------------------------------
// CREATE QUOTATION
// ---------------------------------------------------------
const createQuotation = (req, res) => {
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

    quotation_discount_type = null, // FLAT | PERCENT
    quotation_discount_value = 0
  } = req.body

  if (!lead_id || !quotation_date || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Invalid payload' })
  }

  db.getConnection((err, connection) => {
    if (err) return res.status(500).json({ error: err.message })

    connection.beginTransaction(async () => {
      try {
        /* ----------------------------------
           SETTINGS
        ---------------------------------- */
        const settings = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT * FROM quotation_settings LIMIT 1`,
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          )
        })

        const quotationMode = settings.quotation_mode || 'GENERAL'
        const gstPricingMode = settings.gst_pricing_mode || 'EXCLUSIVE'

        if (quotationMode === 'CATERING' && (!pax || pax < 1)) {
          throw new Error('PAX required for catering')
        }

        /* ----------------------------------
           SEQUENCE
        ---------------------------------- */
        const seqRow = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT MAX(quotation_sequence) AS maxSeq FROM quotations`,
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          )
        })

        const nextSeq = seqRow.maxSeq
          ? seqRow.maxSeq + 1
          : settings.sequence_start

        const quotation_number = generateQuotationNumber(settings, nextSeq)

        /* ----------------------------------
           VERSIONING
          ---------------------------------- */
          let rootId = parent_id

          if (parent_id) {
            let cursor = parent_id
            while (true) {
              const row = await new Promise((resolve, reject) => {
                connection.query(
                  `SELECT parent_id FROM quotations WHERE id = ?`,
                  [cursor],
                  (err, rows) => (err ? reject(err) : resolve(rows[0]))
                )
              })
              if (!row?.parent_id) break
              cursor = row.parent_id
            }
            rootId = cursor
          }

          const version = rootId
            ? (
                await new Promise((resolve, reject) => {
                  connection.query(
                    `
                    SELECT MAX(version) AS v
                    FROM quotations
                    WHERE id = ? OR parent_id = ?
                    `,
                    [rootId, rootId],
                    (err, rows) => (err ? reject(err) : resolve(rows[0]?.v || 0))
                  )
                })
              ) + 1
            : 1


        /* ----------------------------------
           INSERT HEADER
        ---------------------------------- */
        const header = await new Promise((resolve, reject) => {
          connection.query(
            `
            INSERT INTO quotations (
              lead_id, quotation_date, valid_until, notes,
              status, quotation_number, quotation_sequence,
              version, parent_id, quotation_mode,
              pax, event_name, event_date, event_time, event_location,
              quotation_discount_type, quotation_discount_value
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              lead_id,
              toMySQLDate(quotation_date),
              toMySQLDate(valid_until),
              notes,
              quotation_number,
              nextSeq,
              version,
              rootId,
              quotationMode,
              pax,
              event_name,
              toMySQLDate(event_date),
              event_time,
              event_location,
              quotation_discount_type,
              quotation_discount_value
            ],
            (err, result) => (err ? reject(err) : resolve(result))
          )
        })

        /* ----------------------------------
           INSERT ITEMS
        ---------------------------------- */
        await insertQuotationItemsSnapshot(connection, header.insertId, items)

        /* ----------------------------------
           TOTALS (PAX SAFE)
        ---------------------------------- */
        const totals = await new Promise((resolve, reject) => {
          connection.query(
            `
            SELECT
              IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS paxFactor,

              SUM(qi.selling_price * qi.quantity)
                * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS subtotal,

              SUM(qi.discount)
                * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS item_discount_total,

              SUM(qi.line_total)
                * IF(q.quotation_mode='CATERING', IFNULL(q.pax,1), 1) AS base_amount,

              SUM(
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
              ) AS total_tax
            FROM quotation_items qi
            JOIN quotations q ON q.id = qi.quotation_id
            WHERE qi.quotation_id = ?
            `,
            [gstPricingMode, header.insertId],
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          )
        })

        /* ----------------------------------
           QUOTATION LEVEL DISCOUNT
        ---------------------------------- */
        let quotation_discount_amount = 0
        const baseAmount = Number(totals.base_amount || 0)

        if (quotation_discount_type === 'PERCENT') {
          if (quotation_discount_value < 0 || quotation_discount_value > 100) {
            throw new Error('Discount percent must be between 0 and 100')
          }
          quotation_discount_amount = (baseAmount * quotation_discount_value) / 100
        }

        if (quotation_discount_type === 'FLAT') {
          quotation_discount_amount = Math.max(0, quotation_discount_value)
        }

        const total_discount =
          Number(totals.item_discount_total || 0) + quotation_discount_amount

        const total_amount = Math.max(
          0,
          baseAmount - quotation_discount_amount
        )

        /* ----------------------------------
           UPDATE QUOTATION
        ---------------------------------- */
        await new Promise((resolve, reject) => {
          connection.query(
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
              totals.subtotal,
              total_discount,
              totals.total_tax,
              total_amount,
              quotation_discount_amount,
              header.insertId
            ],
            err => (err ? reject(err) : resolve())
          )
        })

        /* ----------------------------------
           COMMIT
        ---------------------------------- */
        connection.commit(() => {
          connection.release()
          res.status(201).json({
            id: header.insertId,
            quotation_number,
            totals: {
              subtotal: totals.subtotal,
              item_discount: totals.item_discount_total,
              quotation_discount: quotation_discount_amount,
              total_discount,
              tax: totals.total_tax,
              total: total_amount
            }
          })
        })
      } catch (e) {
        connection.rollback(() => {
          connection.release()
          res.status(500).json({ error: e.message })
        })
      }
    })
  })
}

// ---------------------------------------------------------
// UPDATE QUOTATION
// ---------------------------------------------------------
const updateQuotation = (req, res) => {
  const { id } = req.params

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

    quotation_discount_type = null,
    quotation_discount_value = 0
  } = req.body

  // ✅ helper to safely convert empty string -> null
  const safeDate = (d) => {
    if (!d) return null
    const s = String(d).trim()
    if (!s) return null
    return toMySQLDate(s)
  }

  db.getConnection((err, connection) => {
    if (err) return res.status(500).json({ error: err.message })

    connection.beginTransaction(async () => {
      try {
        /* ----------------------------------
           FETCH SETTINGS
        ---------------------------------- */
        const settings = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT * FROM quotation_settings LIMIT 1`,
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          )
        })

        const gstPricingMode = settings.gst_pricing_mode || 'EXCLUSIVE'

        /* ----------------------------------
           UPDATE HEADER FIELDS
        ---------------------------------- */
        await new Promise((resolve, reject) => {
          connection.query(
            `
            UPDATE quotations
            SET
              lead_id = COALESCE(?, lead_id),
              quotation_date = COALESCE(?, quotation_date),
              valid_until = COALESCE(?, valid_until),
              notes = COALESCE(?, notes),
              pax = COALESCE(?, pax),
              event_name = ?,
              event_date = ?,
              event_time = ?,
              event_location = ?,
              quotation_discount_type = ?,
              quotation_discount_value = ?
            WHERE id = ?
            `,
            [
              lead_id ?? null,
              safeDate(quotation_date),
              safeDate(valid_until),
              notes ?? null,
              pax ?? null,
              event_name || null,
              safeDate(event_date),
              event_time || null,
              event_location || null,
              quotation_discount_type,
              Number(quotation_discount_value || 0),
              id
            ],
            (err) => (err ? reject(err) : resolve())
          )
        })

        /* ----------------------------------
           RECALCULATE TOTALS (SAME AS CREATE)
        ---------------------------------- */
        const totalsRaw = await new Promise((resolve, reject) => {
          connection.query(
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
            [gstPricingMode, id],
            (err, rows) => (err ? reject(err) : resolve(rows[0] || {}))
          )
        })

        const totals = {
          subtotal: Number(totalsRaw.subtotal || 0),
          item_discount_total: Number(totalsRaw.item_discount_total || 0),
          base_amount: Number(totalsRaw.base_amount || 0),
          total_tax: Number(totalsRaw.total_tax || 0)
        }

        /* ----------------------------------
           APPLY QUOTATION DISCOUNT
        ---------------------------------- */
        const baseAmount = Number(totals.base_amount || 0)
        const discountValue = Number(quotation_discount_value || 0)

        let quotation_discount_amount = 0

        if (quotation_discount_type === 'PERCENT') {
          if (discountValue < 0 || discountValue > 100) {
            throw new Error('Discount percent must be between 0 and 100')
          }
          quotation_discount_amount = (baseAmount * discountValue) / 100
        }

        if (quotation_discount_type === 'FLAT') {
          quotation_discount_amount = Math.max(0, discountValue)
        }

        const total_discount =
          Number(totals.item_discount_total || 0) + quotation_discount_amount

        const total_amount = Math.max(0, baseAmount - quotation_discount_amount)

        /* ----------------------------------
           UPDATE TOTALS SNAPSHOT
        ---------------------------------- */
        await new Promise((resolve, reject) => {
          connection.query(
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
              totals.subtotal,
              total_discount,
              totals.total_tax,
              total_amount,
              quotation_discount_amount,
              id
            ],
            (err) => (err ? reject(err) : resolve())
          )
        })

        /* ----------------------------------
           COMMIT
        ---------------------------------- */
        connection.commit(() => {
          connection.release()
          res.status(200).json({
            message: 'Quotation updated successfully',
            totals: {
              subtotal: totals.subtotal,
              item_discount: totals.item_discount_total,
              quotation_discount: quotation_discount_amount,
              total_discount,
              tax: totals.total_tax,
              total: total_amount
            }
          })
        })
      } catch (e) {
        connection.rollback(() => {
          connection.release()
          res.status(500).json({ error: e.message })
        })
      }
    })
  })
}



// ---------------------------------------------------------
// OTHER METHODS (UNCHANGED LOGIC)
// ---------------------------------------------------------
const getQuotations = (req, res) => {
  db.query(
    `
    SELECT
      q.*,
      l.first_name,
      l.last_name
    FROM quotations q
    LEFT JOIN leads l ON q.lead_id = l.id
    ORDER BY q.id DESC
    `,
    (err, rows) =>
      err
        ? res.status(500).json({ error: err.message })
        : res.json(rows)
  )
}

const getQuotationById = (req, res) => {
  const { id } = req.params

  db.query(`SELECT * FROM quotations WHERE id = ?`, [id], (err, rows) => {
    if (err || !rows.length)
      return res.status(404).json({ error: 'Quotation not found' })

    const quotation = rows[0]

    db.query(
      `SELECT * FROM quotation_items WHERE quotation_id = ?`,
      [id],
      (err, items) => {
        if (err)
          return res.status(500).json({ error: err.message })

        quotation.items = items

        res.json(quotation)
      }
    )
  })
}






// ---------------------------------------------------------
// DELETE QUOTATION
// ---------------------------------------------------------
const deleteQuotation = (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT is_locked FROM quotations WHERE id = ?`,
    [id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: err.message });

      if (!rows.length)
        return res.status(404).json({ error: 'Quotation not found' });

      if (rows[0].is_locked) {
        return res.status(403).json({
          error: 'Approved quotations cannot be deleted'
        });
      }

      // ⬇️ YOUR EXISTING CODE (UNCHANGED)
      db.getConnection((err, conn) => {
        if (err)
          return res.status(500).json({ error: 'DB connection failed', details: err.message });

        conn.beginTransaction((err) => {
          if (err) {
            conn.release();
            return res.status(500).json({ error: 'Transaction start failed', details: err.message });
          }

          conn.query(`DELETE FROM quotation_items WHERE quotation_id = ?`, [id], (err) => {
            if (err)
              return conn.rollback(() => {
                conn.release();
                res.status(500).json({ error: 'Failed to delete items', details: err.message });
              });

            conn.query(`DELETE FROM quotations WHERE id = ?`, [id], (err) => {
              if (err)
                return conn.rollback(() => {
                  conn.release();
                  res.status(500).json({ error: 'Failed to delete quotation', details: err.message });
                });

              conn.commit((err) => {
                conn.release();
                if (err)
                  return res.status(500).json({ error: 'Commit failed', details: err.message });

                res.status(200).json({ message: 'Quotation deleted successfully' });
              });
            });
          });
        });
      });
    }
  );
};

// ---------------------------------------------------------
// UPDATE STATUS
// ---------------------------------------------------------
const updateQuotationStatus = (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status)
    return res.status(400).json({ error: 'Status is required' });

  db.getConnection((err, conn) => {
    if (err)
      return res.status(500).json({ error: 'DB connection failed', details: err.message });

    conn.beginTransaction(async (txErr) => {
      if (txErr) {
        conn.release();
        return res.status(500).json({ error: 'Transaction start failed', details: txErr.message });
      }

      try {
        const quotation = await new Promise((resolve, reject) => {
          conn.query(
            `SELECT status, is_locked FROM quotations WHERE id = ?`,
            [id],
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          );
        });

        if (!quotation) throw new Error('Quotation not found');

        // ❌ Block re-approval
        if (quotation.status === 'approved' && status === 'approved') {
          throw new Error('Quotation already approved');
        }

        if (status === 'approved') {
          const rootId = await getRootQuotationId(conn, id);

          // 🔒 Lock all versions
          await new Promise((resolve, reject) => {
            conn.query(
              `
              UPDATE quotations
              SET
                is_locked = 1,
                status = CASE
                  WHEN id = ? THEN 'approved'
                  ELSE 'rejected'
                END
              WHERE id = ? OR parent_id = ?
              `,
              [id, rootId, rootId],
              (err) => (err ? reject(err) : resolve())
            );
          });
        } else {
          // Normal status change (allowed even if locked)
          await new Promise((resolve, reject) => {
            conn.query(
              `UPDATE quotations SET status = ? WHERE id = ?`,
              [status, id],
              (err) => (err ? reject(err) : resolve())
            );
          });
        }

        conn.commit(() => {
          conn.release();
          res.status(200).json({ message: 'Status updated successfully', status });
        });

      } catch (error) {
        conn.rollback(() => {
          conn.release();
          res.status(500).json({ error: error.message });
        });
      }
    });
  });
};

// ---------------------------------------------------------
// UPDATE QUOTATION ITEMS (delete + reinsert + recalc total)
// ---------------------------------------------------------
const updateQuotationItems = (req, res) => {
  const { id } = req.params
  const { items } = req.body

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' })
  }

  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message })
    }

    connection.beginTransaction(async () => {
      try {
        /* ----------------------------------
           SAFETY CHECK
        ---------------------------------- */
        const quotation = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT status, is_locked FROM quotations WHERE id = ?`,
            [id],
            (err, rows) => (err ? reject(err) : resolve(rows[0]))
          )
        })

        if (!quotation) throw new Error('Quotation not found')
        if (quotation.is_locked) throw new Error('Locked quotations cannot be edited')

        /* ----------------------------------
           🔴 FETCH SETTINGS (THIS WAS MISSING)
        ---------------------------------- */
        const settings = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT * FROM quotation_settings LIMIT 1`,
            (err, rows) => (err ? reject(err) : resolve(rows[0] || {}))
          )
        })

        // ✅ NOW IT EXISTS
        const gstPricingMode = settings.gst_pricing_mode || 'EXCLUSIVE'

        /* ----------------------------------
           DELETE OLD ITEMS
        ---------------------------------- */
        await new Promise((resolve, reject) => {
          connection.query(
            `DELETE FROM quotation_items WHERE quotation_id = ?`,
            [id],
            (err) => (err ? reject(err) : resolve())
          )
        })

        /* ----------------------------------
           INSERT SNAPSHOT ITEMS
        ---------------------------------- */
        await insertQuotationItemsSnapshot(connection, id, items)

        /* ----------------------------------
           RECALCULATE TOTALS
        ---------------------------------- */
        const totals = await new Promise((resolve, reject) => {
          connection.query(
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
            [gstPricingMode, id],
            (err, rows) => (err ? reject(err) : resolve(rows[0] || {}))
          )
        })

        /* ----------------------------------
           UPDATE QUOTATION TOTALS
        ---------------------------------- */
        await new Promise((resolve, reject) => {
          connection.query(
            `
            UPDATE quotations
            SET
              subtotal = ?,
              total_discount = ?,
              total_tax = ?,
              total_amount = ?
            WHERE id = ?
            `,
            [
              totals.subtotal || 0,
              totals.item_discount_total || 0,
              totals.total_tax || 0,
              totals.base_amount || 0,
              id
            ],
            (err) => (err ? reject(err) : resolve())
          )
        })

        /* ----------------------------------
           COMMIT
        ---------------------------------- */
        connection.commit(() => {
          connection.release()
          res.json({
            message: 'Quotation items updated successfully',
            totals
          })
        })

      } catch (error) {
        console.error('❌ updateQuotationItems failed:', error)
        connection.rollback(() => {
          connection.release()
          res.status(500).json({ error: error.message })
        })
      }
    })
  })
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
