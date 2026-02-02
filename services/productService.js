const db = require('../config/db');

async function createProductInternal(payload, connection = null) {
  const {
    name,
    brand = null,
    category_id = 1,
    description = '',
    image_url = null,

    cost_pricing_mode = 'absolute',
    cost_discount_percent = null,

    cost_price = 0,
    cost_price_unit = 'piece',
    cost_price_qty = 1,

    selling_price,
    selling_price_unit = 'piece',
    selling_price_qty = 1,

    gst_rate = 0,
    hsn_sac = null,

    stock = 0,
    sku = '',
    type = 'simple',
    is_active = 1
  } = payload;

  /* ---- VALIDATIONS (copied as-is) ---- */
  if (!name) throw new Error('Product name is required');
  if (selling_price == null || selling_price <= 0)
    throw new Error('selling_price must be > 0');
  if (gst_rate < 0 || gst_rate > 28)
    throw new Error('Invalid gst_rate');

  if (cost_pricing_mode === 'percentage') {
    if (!cost_discount_percent || cost_discount_percent <= 0)
      throw new Error('cost_discount_percent required');
    if (cost_price > 0)
      throw new Error('Do not send cost_price in percentage mode');
  }

  /* ---- COST CALC ---- */
  let finalCostPrice = cost_price;
  if (cost_pricing_mode === 'percentage') {
    finalCostPrice =
      selling_price * (1 - cost_discount_percent / 100);
  }

  const query = `
    INSERT INTO products (
      name, brand, category_id, description, image_url,
      cost_pricing_mode, cost_discount_percent,
      cost_price, cost_price_unit, cost_price_qty,
      selling_price, selling_price_unit, selling_price_qty,
      gst_rate, hsn_sac,
      stock, sku, type, is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    name, brand, category_id, description, image_url,
    cost_pricing_mode, cost_discount_percent,
    finalCostPrice, cost_price_unit, cost_price_qty,
    selling_price, selling_price_unit, selling_price_qty,
    Number(gst_rate || 0), hsn_sac,
    stock, sku, type, is_active
  ];

  const executor = connection || db.promise();
  const [result] = await executor.query(query, params);
  return result.insertId;
}

module.exports = { createProductInternal };
