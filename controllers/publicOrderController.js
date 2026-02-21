const db = require('../config/db');

exports.createOrder = async (req, res) => {
  const { customer, billing, items } = req.body;

  if (!customer?.email || !items?.length) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // ====================================
    // 1️⃣ FIND OR CREATE LEAD
    // ====================================

    const [existingLeadRows] = await connection.query(
      `SELECT id FROM leads WHERE email = ? LIMIT 1`,
      [customer.email]
    );

    let leadId;

    if (existingLeadRows.length) {
      leadId = existingLeadRows[0].id;

      await connection.query(
        `
        UPDATE leads SET
          first_name = ?,
          last_name = ?,
          phone_number = ?,
          shipping_address = ?,
          shipping_landmark = ?,
          shipping_city = ?,
          shipping_state = ?,
          shipping_pincode = ?,
          billing_address = ?,
          billing_landmark = ?,
          billing_city = ?,
          billing_state = ?,
          billing_pincode = ?
        WHERE id = ?
        `,
        [
          customer.first_name,
          customer.last_name,
          customer.phone,
          customer.address,
          customer.landmark,
          customer.city,
          customer.state,
          customer.pincode,
          billing.address,
          billing.landmark,
          billing.city,
          billing.state,
          billing.pincode,
          leadId
        ]
      );
    } else {
      const [insertResult] = await connection.query(
        `
        INSERT INTO leads
        (
          first_name, last_name, email, phone_number,
          shipping_address, shipping_landmark, shipping_city,
          shipping_state, shipping_pincode,
          billing_address, billing_landmark, billing_city,
          billing_state, billing_pincode, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WEBSITE')
        `,
        [
          customer.first_name,
          customer.last_name,
          customer.email,
          customer.phone,
          customer.address,
          customer.landmark,
          customer.city,
          customer.state,
          customer.pincode,
          billing.address,
          billing.landmark,
          billing.city,
          billing.state,
          billing.pincode
        ]
      );

      leadId = insertResult.insertId;
    }

    // ====================================
    // 2️⃣ FETCH SETTINGS
    // ====================================

    const [[settings]] = await connection.query(
      `SELECT * FROM settings WHERE id = 1`
    );

    const gstEnabled = settings?.gst_enabled === 1;
    const pricingMode = settings?.gst_pricing_mode || 'INCLUSIVE';
    const companyState = (settings?.company_state || '').trim();
    const billingState = (billing.state || '').trim();

    const isIntraState =
      companyState &&
      billingState &&
      companyState.toLowerCase() === billingState.toLowerCase();

    // ====================================
    // 3️⃣ CALCULATE TOTALS + LINE BREAKDOWN
    // ====================================

    let subtotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    const computedItems = [];

    for (const item of items) {

      const qty = Number(item.qty);
      const price = Number(item.selling_price);
      const gstRate = Number(item.gst_rate || 0);

      if (!qty || !price) {
        throw new Error('Invalid item data');
      }

      let taxableAmount = 0;
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;
      let lineTotal = 0;

      if (!gstEnabled || gstRate === 0) {

        taxableAmount = qty * price;
        lineTotal = taxableAmount;

      } else {

        if (pricingMode === 'EXCLUSIVE') {

          taxableAmount = qty * price;
          const gstAmount = taxableAmount * gstRate / 100;

          if (isIntraState) {
            cgstAmount = gstAmount / 2;
            sgstAmount = gstAmount / 2;
          } else {
            igstAmount = gstAmount;
          }

          lineTotal = taxableAmount + gstAmount;

        } else { // INCLUSIVE

          const basePrice = price / (1 + gstRate / 100);
          taxableAmount = basePrice * qty;

          const gstAmount = (price * qty) - taxableAmount;

          if (isIntraState) {
            cgstAmount = gstAmount / 2;
            sgstAmount = gstAmount / 2;
          } else {
            igstAmount = gstAmount;
          }

          lineTotal = price * qty;
        }
      }

      subtotal += taxableAmount;
      cgstTotal += cgstAmount;
      sgstTotal += sgstAmount;
      igstTotal += igstAmount;

      computedItems.push({
        product_id: item.id || null,
        description: item.name,
        quantity: qty,
        unit_price: price,
        gst_rate: gstRate,
        taxable_amount: taxableAmount,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        line_total: lineTotal
      });
    }

    const grandTotal = subtotal + cgstTotal + sgstTotal + igstTotal;

    const year = new Date().getFullYear();

    // ====================================
    // 4️⃣ CREATE WORK ORDER
    // ====================================

    const [[{ maxSeq: woMaxSeq }]] = await connection.query(
      `SELECT MAX(work_order_sequence) AS maxSeq FROM work_orders`
    );

    const nextWoSeq = (woMaxSeq || 0) + 1;
    const workOrderNumber = `WO/${year}/${String(nextWoSeq).padStart(4, '0')}`;

    const [woResult] = await connection.query(
      `
      INSERT INTO work_orders
      (
        work_order_number,
        work_order_sequence,
        status,
        issue_date,
        customer_name,
        total_amount,
        lead_id
      )
      VALUES (?, ?, 'issued', CURDATE(), ?, ?, ?)
      `,
      [
        workOrderNumber,
        nextWoSeq,
        `${customer.first_name} ${customer.last_name}`.trim(),
        grandTotal,
        leadId
      ]
    );

    const workOrderId = woResult.insertId;

    // ====================================
    // 5️⃣ CREATE INVOICE
    // ====================================

    const [[{ maxSeq: invMaxSeq }]] = await connection.query(
      `SELECT MAX(invoice_sequence) AS maxSeq FROM invoices`
    );

    const nextInvSeq = (invMaxSeq || 0) + 1;
    const invoiceNumber = `INV/${year}/${String(nextInvSeq).padStart(4, '0')}`;

    const [invoiceResult] = await connection.query(
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
        grand_total
      )
      VALUES (?, ?, 'FRONTEND_ORDER', ?, ?, CURDATE(), 'issued', ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        invoiceNumber,
        nextInvSeq,
        workOrderId,
        leadId,
        JSON.stringify(billing),
        JSON.stringify(customer),
        subtotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        grandTotal
      ]
    );

    const invoiceId = invoiceResult.insertId;

    // ====================================
    // 6️⃣ INSERT INVOICE ITEMS
    // ====================================

    for (const it of computedItems) {
      await connection.query(
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
          it.line_total
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      message: 'Order + Invoice created successfully',
      work_order_id: workOrderId,
      invoice_id: invoiceId,
      invoice_number: invoiceNumber
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('🔥 ORDER ERROR:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};
