const db = require('../config/db');

// -------------------- PRODUCTS --------------------

const getAllProducts = async (req, res) => {
  try {
    const [categories] = await db.query(
      `SELECT id, name, parent_id FROM categories`
    );

    const categoryMap = {};
    categories.forEach(c => (categoryMap[c.id] = c));

    const getCategoryChain = (catId) => {
      if (!catId) return 'Uncategorized';
      const chain = [];
      let current = categoryMap[catId];
      while (current) {
        chain.unshift(current.name);
        current = categoryMap[current.parent_id];
      }
      return chain.join(' > ');
    };

    const [products] = await db.query(`
    SELECT 
      p.id,
      p.name,
      p.brand,
      p.description,
      p.image_url,
  
  
      p.cost_pricing_mode,
      p.cost_discount_percent,
  
      p.cost_price,
      p.cost_price_unit,
      p.cost_price_qty,
  
      p.selling_price,
      p.selling_price_unit,
      p.selling_price_qty,
  
      p.gst_rate,
      p.hsn_sac,
  
      p.stock,
      p.category_id,
      p.type,
      p.sku,
      p.is_active,
      p.created_at,
  
      COUNT(v.id) AS variant_count
    FROM products p
    LEFT JOIN variants v 
      ON p.id = v.product_id AND v.is_active = 1
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
  

    const enriched = products.map(p => ({
      ...p,
      category_name: getCategoryChain(p.category_id)
    }));

    res.status(200).json(enriched);

  } catch (err) {
    console.error('❌ getAllProducts:', err);
    res.status(500).json({
      error: 'Failed to fetch products',
      details: err.message
    });
  }
};

const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const [[product]] = await db.query(
      `
      SELECT 
      id,
      name,
      brand,
      description,
      image_url,


      cost_pricing_mode,
      cost_discount_percent,

      cost_price,
      cost_price_unit,
      cost_price_qty,

      selling_price,
      selling_price_unit,
      selling_price_qty,

      gst_rate,
      hsn_sac,

      stock,
      category_id,
      type,
      sku,
      is_active,
      created_at
    FROM products
    WHERE id = ?

      `,
      [id]
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [variantsRaw] = await db.query(
      `
      SELECT 
        v.id AS variant_id,
        v.sku,
        v.stock,
        v.cost AS cost_price,
        v.cost_unit AS cost_price_unit,

        pp.packaging_type,
        pp.packaging_weight,
        pp.packaging_unit,
        pp.length,
        pp.width,
        pp.height,
        pp.dimensions_unit
      FROM variants v
      LEFT JOIN product_packaging pp ON pp.variant_id = v.id
      WHERE v.product_id = ? AND v.is_active = 1
      `,
      [id]
    );

    if (!variantsRaw.length) {
      return res.json({ ...product, variants: [] });
    }

    const variantIds = variantsRaw.map(v => v.variant_id);

    const [attrRows] = await db.query(
      `
      SELECT 
        vav.variant_id,
        ao.id AS option_id,
        ao.value,
        ao.attribute_id
      FROM variant_attribute_values vav
      JOIN attribute_options ao ON ao.id = vav.attribute_option_id
      WHERE vav.variant_id IN (?)
      `,
      [variantIds]
    );

    const variantMap = {};

    variantsRaw.forEach(v => {
      variantMap[v.variant_id] = {
        id: v.variant_id,
        sku: v.sku,
        stock: v.stock,
        cost_price: v.cost_price,
        cost_price_unit: v.cost_price_unit,
        attributes: [],
        packaging: {
          packaging_type: v.packaging_type,
          packaging_weight: v.packaging_weight,
          packaging_unit: v.packaging_unit,
          length: v.length,
          width: v.width,
          height: v.height,
          dimensions_unit: v.dimensions_unit
        }
      };
    });

    attrRows.forEach(a => {
      if (variantMap[a.variant_id]) {
        variantMap[a.variant_id].attributes.push({
          id: a.option_id,
          value: a.value,
          attribute_id: a.attribute_id
        });
      }
    });

    res.json({
      ...product,
      variants: Object.values(variantMap)
    });

  } catch (err) {
    console.error('❌ getProductById:', err);
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message
    });
  }
};


const createProduct = async (req, res) => {
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
    is_active = 1,
    variants = []
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  if (selling_price == null || selling_price <= 0) {
    return res.status(400).json({
      error: 'selling_price is required and must be > 0'
    });
  }

  let finalCostPrice = cost_price;

  if (cost_pricing_mode === 'percentage') {
    if (!cost_discount_percent || cost_discount_percent <= 0) {
      return res.status(400).json({
        error: 'cost_discount_percent is required for percentage pricing'
      });
    }

    finalCostPrice =
      selling_price * (1 - cost_discount_percent / 100);
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [productResult] = await connection.query(
      `
      INSERT INTO products (
        name, brand, category_id, description, image_url,
        cost_pricing_mode, cost_discount_percent,
        cost_price, cost_price_unit, cost_price_qty,
        selling_price, selling_price_unit, selling_price_qty,
        gst_rate, hsn_sac,
        stock, sku, type, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name,
        brand,
        category_id,
        description,
        image_url,

        cost_pricing_mode,
        cost_discount_percent,

        finalCostPrice,
        cost_price_unit,
        cost_price_qty,

        selling_price,
        selling_price_unit,
        selling_price_qty,

        Number(gst_rate || 0),
        hsn_sac,

        stock,
        sku,
        type,
        is_active
      ]
    );

    const productId = productResult.insertId;

    if (type === 'variable' && Array.isArray(variants) && variants.length) {
      const variantValues = variants.map(v => [
        productId,
        v.sku || '',
        v.stock || 0,
        v.cost_price ?? finalCostPrice,
        v.cost_price_unit ?? cost_price_unit,
        1
      ]);

      await connection.query(
        `
        INSERT INTO variants
        (product_id, sku, stock, cost, cost_unit, is_active)
        VALUES ?
        `,
        [variantValues]
      );
    }

    await connection.commit();
    connection.release();

    return res.status(201).json({
      message: 'Product created successfully',
      id: productId
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    return res.status(500).json({
      error: 'Failed to create product',
      details: err.message
    });
  }
};


const updateProduct = async (req, res) => {
  const { id } = req.params;

  const {
    name,
    brand = null,
    category_id,
    description = '',
    image_url = null,

    // Pricing mode
    cost_pricing_mode = 'absolute',
    cost_discount_percent = null,

    // Cost
    cost_price = 0,
    cost_price_unit = 'piece',
    cost_price_qty = 1,

    // Selling price
    selling_price,
    selling_price_unit = 'piece',
    selling_price_qty = 1,

    // GST
    gst_rate = 0,
    hsn_sac = null,

    stock = 0,
    sku = '',
    type = 'simple',
    is_active = 1,
    variants = []
  } = req.body;

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    /* ---------------- FETCH EXISTING PRODUCT ---------------- */

    const [[existingProduct]] = await connection.query(
      `SELECT selling_price FROM products WHERE id = ?`,
      [id]
    );

    if (!existingProduct) {
      throw new Error('Product not found');
    }

    const effectiveSellingPrice =
      selling_price ?? existingProduct.selling_price;

    /* ---------------- VALIDATIONS ---------------- */

    if (!name) {
      throw new Error('Product name is required');
    }

    if (brand && brand.length > 100) {
      throw new Error('Brand must be under 100 characters');
    }

    if (effectiveSellingPrice <= 0) {
      throw new Error('selling_price must be > 0');
    }

    if (gst_rate < 0 || gst_rate > 28) {
      throw new Error('Invalid gst_rate');
    }

    if (cost_pricing_mode === 'percentage') {
      if (!cost_discount_percent || cost_discount_percent <= 0) {
        throw new Error('cost_discount_percent is required for percentage pricing');
      }
      if (cost_price > 0) {
        throw new Error('Do not send cost_price in percentage pricing mode');
      }
    }

    /* ---------------- COST CALCULATION ---------------- */

    let finalCostPrice = cost_price;

    if (cost_pricing_mode === 'percentage') {
      finalCostPrice =
        effectiveSellingPrice * (1 - cost_discount_percent / 100);
    }

    /* ---------------- UPDATE PRODUCT ---------------- */

    await connection.query(
      `
      UPDATE products SET
        name=?,
        brand=?,
        category_id=?,
        description=?,
        image_url=?,

        cost_pricing_mode=?,
        cost_discount_percent=?,

        cost_price=?,
        cost_price_unit=?,
        cost_price_qty=?,

        selling_price=?,
        selling_price_unit=?,
        selling_price_qty=?,

        gst_rate=?,
        hsn_sac=?,

        stock=?,
        sku=?,
        type=?,
        is_active=?
      WHERE id=?
    `,
      [
        name,
        brand,
        category_id,
        description,
        image_url,

        cost_pricing_mode,
        cost_discount_percent,

        finalCostPrice,
        cost_price_unit,
        cost_price_qty,

        effectiveSellingPrice,
        selling_price_unit,
        selling_price_qty,

        Number(gst_rate || 0),
        hsn_sac,

        stock,
        sku,
        type,
        is_active,
        id
      ]
    );

    /* ---------------- VARIANT HANDLING ---------------- */

    const [existingVariants] = await connection.query(
      'SELECT id FROM variants WHERE product_id = ?',
      [id]
    );

    const existingIds = existingVariants.map(v => v.id);
    const incomingIds = variants.filter(v => v.id).map(v => v.id);

    const removed = existingIds.filter(v => !incomingIds.includes(v));
    if (removed.length) {
      await connection.query(
        'UPDATE variants SET is_active = 0 WHERE id IN (?)',
        [removed]
      );
    }

    for (const v of variants.filter(v => v.id)) {
      await connection.query(
        `
        UPDATE variants SET
          sku=?,
          stock=?,
          cost=?,
          cost_unit=?,
          is_active=1
        WHERE id=? AND product_id=?
      `,
        [
          v.sku || '',
          v.stock || 0,
          v.cost_price ?? finalCostPrice,
          v.cost_price_unit ?? cost_price_unit,
          v.id,
          id
        ]
      );
    }

    for (const v of variants.filter(v => !v.id)) {
      await connection.query(
        `
        INSERT INTO variants
        (product_id, sku, stock, cost, cost_unit, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `,
        [
          id,
          v.sku || '',
          v.stock || 0,
          v.cost_price ?? finalCostPrice,
          v.cost_price_unit ?? cost_price_unit
        ]
      );
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      message: 'Product updated successfully'
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('❌ updateProduct error:', error.message);

    return res.status(500).json({
      error: 'Failed to update product',
      details: error.message
    });
  }
};


const deleteProduct = async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    /* =====================================================
       1️⃣ CHECK DIRECT PRODUCT USAGE IN QUOTATIONS
    ===================================================== */

    const [directUsageRows] = await connection.query(
      `SELECT COUNT(*) AS cnt 
       FROM quotation_items 
       WHERE product_id = ?`,
      [id]
    );

    const isDirectlyUsed = directUsageRows[0].cnt > 0;

    /* =====================================================
       2️⃣ FETCH VARIANTS
    ===================================================== */

    const [variants] = await connection.query(
      `SELECT id FROM variants WHERE product_id = ?`,
      [id]
    );

    const variantIds = variants.map(v => v.id);

    /* =====================================================
       3️⃣ CHECK VARIANT USAGE IN QUOTATIONS
    ===================================================== */

    let isVariantUsed = false;

    if (variantIds.length) {
      const [variantUsageRows] = await connection.query(
        `SELECT COUNT(*) AS cnt 
         FROM quotation_items 
         WHERE variant_id IN (?)`,
        [variantIds]
      );

      isVariantUsed = variantUsageRows[0].cnt > 0;
    }

    /* =====================================================
       4️⃣ IF USED ANYWHERE → ARCHIVE INSTEAD OF DELETE
    ===================================================== */

    if (isDirectlyUsed || isVariantUsed) {
      await connection.query(
        `UPDATE products 
         SET is_active = 0 
         WHERE id = ?`,
        [id]
      );

      await connection.commit();
      connection.release();

      return res.status(200).json({
        message: 'Product archived (used in quotations)',
      });
    }

    /* =====================================================
       5️⃣ SAFE HARD DELETE (NOT USED ANYWHERE)
    ===================================================== */

    if (variantIds.length) {
      await connection.query(
        `DELETE FROM variant_attribute_values 
         WHERE variant_id IN (?)`,
        [variantIds]
      );

      await connection.query(
        `DELETE FROM product_packaging 
         WHERE variant_id IN (?)`,
        [variantIds]
      );

      await connection.query(
        `DELETE FROM variants 
         WHERE product_id = ?`,
        [id]
      );
    }

    await connection.query(
      `DELETE FROM product_packaging 
       WHERE product_id = ?`,
      [id]
    );

    const [result] = await connection.query(
      `DELETE FROM products 
       WHERE id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      throw new Error('Product not found');
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      message: 'Product deleted successfully',
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('❌ deleteProduct:', err);

    return res.status(500).json({
      error: 'Failed to delete product',
      details: err.message,
    });
  }
};

// -------------------- VARIANTS --------------------
const createVariant = async (req, res) => {
  const { product_id, sku, stock, cost_price, cost_price_unit } = req.body;

  if (!product_id || !sku) {
    return res.status(400).json({ error: 'Missing required fields for variant' });
  }

  try {
    const [result] = await db.query(
      `
      INSERT INTO variants 
      (product_id, sku, stock, cost, cost_unit, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
      `,
      [
        product_id,
        sku,
        stock || 0,
        cost_price || 0,
        cost_price_unit || 'piece'
      ]
    );

    res.status(201).json({
      message: 'Variant created successfully',
      variantId: result.insertId
    });

  } catch (err) {
    console.error('createVariant error:', err);
    res.status(500).json({
      error: 'Failed to create variant',
      details: err.message
    });
  }
};


const getVariantByProductId = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT * 
      FROM variants 
      WHERE product_id = ? AND is_active = 1
      `,
      [req.params.id]
    );

    res.status(200).json(rows);

  } catch (err) {
    console.error('getVariantByProductId error:', err);
    res.status(500).json({
      error: 'Failed to fetch variants',
      details: err.message
    });
  }
};



// -------------------- VARIANT + ATTRIBUTES (COMBINED) --------------------
const createVariantWithAttributes = async (req, res) => {
  const { product_id, stock, sku, cost_price, cost_price_unit, attribute_option_ids } = req.body;

  if (!product_id || !sku || !Array.isArray(attribute_option_ids) || !attribute_option_ids.length) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [[product]] = await connection.query(
      `SELECT type FROM products WHERE id = ?`,
      [product_id]
    );

    if (!product) {
      throw new Error('Product not found');
    }

    if (product.type !== 'variable') {
      throw new Error('Cannot create variants for a simple product');
    }

    const [variantResult] = await connection.query(
      `
      INSERT INTO variants
      (product_id, stock, sku, cost, cost_unit, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
      `,
      [
        product_id,
        stock || 0,
        sku,
        cost_price || 0,
        cost_price_unit || 'piece'
      ]
    );

    const variantId = variantResult.insertId;

    const values = attribute_option_ids.map(id => [variantId, id]);

    await connection.query(
      `
      INSERT INTO variant_attribute_values
      (variant_id, attribute_option_id)
      VALUES ?
      `,
      [values]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Variant created successfully',
      variantId
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    console.error('createVariantWithAttributes error:', err);

    res.status(500).json({
      error: 'Failed to create variant',
      details: err.message
    });
  }
};



const getVariantsByProduct = async (req, res) => {
  try {
    const [variants] = await db.query(
      `
      SELECT v.*,
             GROUP_CONCAT(ao.value SEPARATOR ', ') AS attribute_values
      FROM variants v
      LEFT JOIN variant_attribute_values vav ON v.id = vav.variant_id
      LEFT JOIN attribute_options ao ON vav.attribute_option_id = ao.id
      WHERE v.product_id = ? AND v.is_active = 1
      GROUP BY v.id
      `,
      [req.params.productId]
    );

    res.status(200).json(variants);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch variants',
      details: err.message
    });
  }
};


// -------------------- VARIANT ATTRIBUTE VALUES --------------------
const addVariantAttributeValue = async (req, res) => {
  const { variant_id, attribute_option_id } = req.body;

  if (!variant_id || !attribute_option_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.query(
      `
      INSERT INTO variant_attribute_values
      (variant_id, attribute_option_id)
      VALUES (?, ?)
      `,
      [variant_id, attribute_option_id]
    );

    res.status(201).json({
      message: 'Attribute option added to variant'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to link attribute',
      details: err.message
    });
  }
};

const getAttributesForVariant = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT a.name AS attribute, ao.value AS optionValue
      FROM variant_attribute_values vav
      JOIN attribute_options ao ON vav.attribute_option_id = ao.id
      JOIN attributes a ON ao.attribute_id = a.id
      WHERE vav.variant_id = ?
      `,
      [req.params.id]
    );

    res.status(200).json(rows);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch variant attributes',
      details: err.message
    });
  }
};

// -------------------- CATEGORIES --------------------
const createCategory = async (req, res) => {
  const { category, parent_id } = req.body;

  if (!category?.trim()) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  const slug = category.trim().toLowerCase().replace(/\s+/g, '-');

  try {
    // Check duplicate slug
    const [[existing]] = await db.query(
      `SELECT id FROM categories WHERE slug = ?`,
      [slug]
    );

    if (existing) {
      return res.status(409).json({ error: 'Category already exists' });
    }

    // Validate parent
    if (parent_id) {
      const [[parent]] = await db.query(
        `SELECT id FROM categories WHERE id = ?`,
        [parent_id]
      );

      if (!parent) {
        return res.status(400).json({ error: 'Parent category not found' });
      }
    }

    const [result] = await db.query(
      `INSERT INTO categories (name, slug, parent_id)
       VALUES (?, ?, ?)`,
      [category.trim(), slug, parent_id || null]
    );

    res.status(201).json({
      message: 'Category created successfully',
      categoryId: result.insertId
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to create category',
      details: err.message
    });
  }
};

const getCategories = async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.parent_id,
        COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p 
        ON p.category_id = c.id
      GROUP BY c.id
    `);

    const categoriesMap = {};
    const rootCategories = [];

    // Prepare map
    results.forEach(category => {
      category.children = [];
      category.product_count = Number(category.product_count) || 0;
      categoriesMap[category.id] = category;
    });

    // Build tree
    results.forEach(category => {
      if (category.parent_id) {
        if (categoriesMap[category.parent_id]) {
          categoriesMap[category.parent_id].children.push(category);
        }
      } else {
        rootCategories.push(category);
      }
    });

    res.status(200).json(rootCategories);

  } catch (err) {
    console.error('getCategories error:', err);
    res.status(500).json({
      error: 'Failed to fetch categories',
      details: err.message
    });
  }
};



const getCategoryById = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM categories WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'Category not found'
      });
    }

    res.status(200).json(rows[0]);

  } catch (err) {
    console.error('getCategoryById error:', err);
    res.status(500).json({
      error: 'Failed to fetch category',
      details: err.message
    });
  }
};

const getCategoryByName = async (req, res) => {
  const { name } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM categories WHERE name = ?`,
      [name]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'Category not found'
      });
    }

    res.status(200).json(rows[0]);

  } catch (err) {
    console.error('getCategoryByName error:', err);
    res.status(500).json({
      error: 'Failed to fetch category by name',
      details: err.message
    });
  }
};

const checkCategory = async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      error: 'Name is required'
    });
  }

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');

  try {
    const [rows] = await db.query(
      `SELECT id FROM categories WHERE slug = ?`,
      [slug]
    );

    res.status(200).json({
      exists: rows.length > 0
    });

  } catch (err) {
    console.error('checkCategory error:', err);
    res.status(500).json({
      error: 'Failed to check category',
      details: err.message
    });
  }
};


const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, parent_id } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      error: 'Category name is required'
    });
  }

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');

  try {
    // Prevent self-parent
    if (Number(parent_id) === Number(id)) {
      return res.status(400).json({
        error: 'Category cannot be its own parent'
      });
    }

    // Check slug conflict
    const [[existing]] = await db.query(
      `SELECT id FROM categories WHERE slug = ? AND id != ?`,
      [slug, id]
    );

    if (existing) {
      return res.status(409).json({
        error: 'Another category with this name already exists'
      });
    }

    await db.query(
      `UPDATE categories
       SET name = ?, slug = ?, parent_id = ?
       WHERE id = ?`,
      [name.trim(), slug, parent_id || null, id]
    );

    res.status(200).json({
      message: 'Category updated successfully'
    });

  } catch (err) {
    console.error('updateCategory error:', err);
    res.status(500).json({
      error: 'Failed to update category',
      details: err.message
    });
  }
};


const deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {
    const [[productCount]] = await db.query(
      `SELECT COUNT(*) AS count FROM products WHERE category_id = ?`,
      [id]
    );

    if (productCount.count > 0) {
      return res.status(409).json({
        error: 'Category has products assigned'
      });
    }

    const [[childCount]] = await db.query(
      `SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?`,
      [id]
    );

    if (childCount.count > 0) {
      return res.status(409).json({
        error: 'Category has child categories'
      });
    }

    const [result] = await db.query(
      `DELETE FROM categories WHERE id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'Category not found'
      });
    }

    res.status(200).json({
      message: 'Category deleted successfully'
    });

  } catch (err) {
    console.error('deleteCategory error:', err);
    res.status(500).json({
      error: 'Failed to delete category',
      details: err.message
    });
  }
};



// -------------------- ATTRIBUTES --------------------
const createAttribute = async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Attribute name required' });
  }

  const cleanName = name.trim();

  try {
    const [[existing]] = await db.query(
      `SELECT id FROM attributes WHERE name = ?`,
      [cleanName]
    );

    if (existing) {
      return res.status(409).json({
        error: 'Attribute already exists'
      });
    }

    const [result] = await db.query(
      `INSERT INTO attributes (name) VALUES (?)`,
      [cleanName]
    );

    res.status(201).json({
      message: 'Attribute created',
      attributeId: result.insertId
    });

  } catch (err) {
    console.error('createAttribute error:', err);
    res.status(500).json({
      error: 'Failed to create attribute',
      details: err.message
    });
  }
};


const getAllAttributes = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM attributes ORDER BY name ASC`
    );

    res.status(200).json(rows);

  } catch (err) {
    console.error('getAllAttributes error:', err);
    res.status(500).json({
      error: 'Failed to fetch attributes',
      details: err.message
    });
  }
};


// -------------------- UPDATE ATTRIBUTE --------------------
const updateAttribute = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      error: 'Attribute name required'
    });
  }

  const cleanName = name.trim();

  try {
    // Check if another attribute already has this name
    const [[existing]] = await db.query(
      `SELECT id FROM attributes WHERE name = ? AND id != ?`,
      [cleanName, id]
    );

    if (existing) {
      return res.status(409).json({
        error: 'Another attribute with this name already exists'
      });
    }

    const [result] = await db.query(
      `UPDATE attributes SET name = ? WHERE id = ?`,
      [cleanName, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'Attribute not found'
      });
    }

    res.status(200).json({
      message: 'Attribute updated successfully'
    });

  } catch (err) {
    console.error('updateAttribute error:', err);
    res.status(500).json({
      error: 'Failed to update attribute',
      details: err.message
    });
  }
};

// -------------------- DELETE ATTRIBUTE --------------------
const deleteAttribute = async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Check usage
    const [[usageResult]] = await db.query(`
      SELECT COUNT(*) AS count
      FROM product_attribute_options pao
      JOIN attribute_options ao 
        ON ao.id = pao.attribute_option_id
      WHERE ao.attribute_id = ?
    `, [id]);

    if (usageResult.count > 0) {
      return res.status(409).json({
        error: 'Attribute is used in products. Remove it first.'
      });
    }

    // 2️⃣ Delete attribute options
    await db.query(
      `DELETE FROM attribute_options WHERE attribute_id = ?`,
      [id]
    );

    // 3️⃣ Delete attribute
    const [result] = await db.query(
      `DELETE FROM attributes WHERE id = ?`,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'Attribute not found'
      });
    }

    res.status(200).json({
      message: 'Attribute deleted successfully'
    });

  } catch (err) {
    console.error('deleteAttribute error:', err);
    res.status(500).json({
      error: 'Failed to delete attribute',
      details: err.message
    });
  }
};

// -------------------- ATTRIBUTE OPTIONS --------------------
const createAttributeOption = async (req, res) => {
  const { id: attribute_id } = req.params;
  const { value } = req.body;

  if (!attribute_id) {
    return res.status(400).json({ error: 'Attribute ID required' });
  }

  if (!value?.trim()) {
    return res.status(400).json({ error: 'Option value required' });
  }

  const cleanValue = value.trim();

  try {
    // Check attribute exists
    const [[attribute]] = await db.query(
      `SELECT id FROM attributes WHERE id = ?`,
      [attribute_id]
    );

    if (!attribute) {
      return res.status(404).json({ error: 'Attribute not found' });
    }

    // Check duplicate option
    const [[existing]] = await db.query(
      `SELECT id FROM attribute_options 
       WHERE attribute_id = ? AND value = ?`,
      [attribute_id, cleanValue]
    );

    if (existing) {
      return res.status(409).json({ error: 'Option already exists' });
    }

    const [result] = await db.query(
      `INSERT INTO attribute_options (attribute_id, value)
       VALUES (?, ?)`,
      [attribute_id, cleanValue]
    );

    res.status(201).json({
      message: 'Option created',
      optionId: result.insertId
    });

  } catch (err) {
    console.error('createAttributeOption error:', err);
    res.status(500).json({
      error: 'Failed to create option',
      details: err.message
    });
  }
};


const getAttributeOptions = async (req, res) => {
  const { id: attributeId } = req.params;

  if (!attributeId) {
    return res.status(400).json({ error: 'Attribute ID required' });
  }

  try {
    const [rows] = await db.query(
      `SELECT * 
       FROM attribute_options 
       WHERE attribute_id = ?
       ORDER BY value ASC`,
      [attributeId]
    );

    res.status(200).json(rows);

  } catch (err) {
    console.error('getAttributeOptions error:', err);
    res.status(500).json({
      error: 'Failed to fetch attribute options',
      details: err.message
    });
  }
};


// -------------------- DELETE ATTRIBUTE OPTION --------------------
const deleteAttributeOption = async (req, res) => {
  const { optionId } = req.params;

  if (!optionId) {
    return res.status(400).json({ error: 'Option ID required' });
  }

  try {
    // 1️⃣ Check usage
    const [[usage]] = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM product_attribute_options
      WHERE attribute_option_id = ?
      `,
      [optionId]
    );

    if (usage.count > 0) {
      return res.status(409).json({
        error: 'Option is used in products. Remove it first.'
      });
    }

    // 2️⃣ Delete option
    const [result] = await db.query(
      `DELETE FROM attribute_options WHERE id = ?`,
      [optionId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'Attribute option not found'
      });
    }

    res.status(200).json({
      message: 'Attribute option deleted successfully'
    });

  } catch (err) {
    console.error('deleteAttributeOption error:', err);
    res.status(500).json({
      error: 'Failed to delete attribute option',
      details: err.message
    });
  }
};



// -------------------- ASSIGN ATTRIBUTE TO PRODUCT --------------------
const assignAttributeToProduct = async (req, res) => {
  const { attribute_option_ids } = req.body;
  const { productId } = req.params;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID required' });
  }

  if (!Array.isArray(attribute_option_ids) || !attribute_option_ids.length) {
    return res.status(400).json({ error: 'Attribute options required' });
  }

  try {
    // 1️⃣ Check product exists
    const [[product]] = await db.query(
      `SELECT id FROM products WHERE id = ?`,
      [productId]
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // 2️⃣ Validate options exist
    const [options] = await db.query(
      `SELECT id FROM attribute_options WHERE id IN (?)`,
      [attribute_option_ids]
    );

    if (options.length !== attribute_option_ids.length) {
      return res.status(400).json({
        error: 'One or more attribute options are invalid'
      });
    }

    const values = attribute_option_ids.map(id => [productId, id]);

    await db.query(
      `
      INSERT IGNORE INTO product_attribute_options
      (product_id, attribute_option_id)
      VALUES ?
      `,
      [values]
    );

    res.status(201).json({
      message: 'Attributes assigned successfully'
    });

  } catch (err) {
    console.error('assignAttributeToProduct error:', err);
    res.status(500).json({
      error: 'Failed to assign attributes',
      details: err.message
    });
  }
};



// -------------------- PACKAGING --------------------
const addPackaging = (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Packaging name is required' });

  const query = `INSERT INTO packagings (name) VALUES (?)`;
  db.query(query, [name], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to add packaging', details: err.message });
    res.status(201).json({ message: 'Packaging created', packagingId: result.insertId });
  });
};


// Add packaging for a simple product
const addProductPackaging = async (req, res) => {
  const { productId } = req.params;
  const {
    packagingType,
    packagingWeight,
    packagingUnit,
    length,
    width,
    height,
    dimensionsUnit
  } = req.body;

  try {
    const [existing] = await db.query(
      `SELECT id FROM product_packaging WHERE product_id = ?`,
      [productId]
    );

    if (existing.length) {
      return res.status(400).json({
        error: 'Packaging already exists for this product.'
      });
    }

    await db.query(
      `
      INSERT INTO product_packaging 
      (product_id, packaging_type, packaging_weight, packaging_unit, length, width, height, dimensions_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        productId,
        packagingType,
        packagingWeight,
        packagingUnit,
        length,
        width,
        height,
        dimensionsUnit
      ]
    );

    res.status(201).json({
      message: 'Packaging added successfully.'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to add packaging',
      details: err.message
    });
  }
};



// Get packaging for a simple product
const getProductPackaging = (req, res) => {
  const productId = req.params.productId;

  const query = `
    SELECT id, packaging_type, packaging_weight, packaging_unit,
           length, width, height, dimensions_unit
    FROM product_packaging
    WHERE product_id = ?
  `;
  db.query(query, [productId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch packaging', details: err.message });
    res.status(200).json(results);
  });
};


// Add packaging for a variant
const addVariantPackaging = async (req, res) => {
  const { variantId } = req.params;
  const {
    packagingType,
    packagingWeight,
    packagingUnit,
    length,
    width,
    height,
    dimensionsUnit
  } = req.body;

  try {
    const [existing] = await db.query(
      `SELECT id FROM product_packaging WHERE variant_id = ?`,
      [variantId]
    );

    if (existing.length) {
      return res.status(400).json({
        error: 'Packaging already exists for this variant.'
      });
    }

    await db.query(
      `
      INSERT INTO product_packaging 
      (variant_id, packaging_type, packaging_weight, packaging_unit, length, width, height, dimensions_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        variantId,
        packagingType,
        packagingWeight,
        packagingUnit,
        length,
        width,
        height,
        dimensionsUnit
      ]
    );

    res.status(201).json({
      message: 'Packaging added successfully.'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to add packaging',
      details: err.message
    });
  }
};



// Remove product packaging
const removeProductPackaging = async (req, res) => {
  const { productId } = req.params;

  try {
    const [result] = await db.query(
      `DELETE FROM product_packaging WHERE product_id = ?`,
      [productId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'No packaging found'
      });
    }

    res.json({ message: 'Packaging removed successfully' });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to delete packaging',
      details: err.message
    });
  }
};


// Remove variant packaging
const removeVariantPackaging = async (req, res) => {
  const { variantId } = req.params;

  try {
    const [result] = await db.query(
      `DELETE FROM product_packaging WHERE variant_id = ?`,
      [variantId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        error: 'No packaging found for this variant.'
      });
    }

    res.json({ message: 'Packaging removed successfully.' });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to delete packaging',
      details: err.message
    });
  }
};



// Get packaging for a variant
const getVariantPackaging = (req, res) => {
  const variantId = req.params.variantId;

  const query = `
    SELECT id, packaging_type, packaging_weight, packaging_unit,
           length, width, height, dimensions_unit
    FROM product_packaging
    WHERE variant_id = ?
  `;
  db.query(query, [variantId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch packaging', details: err.message });
    res.status(200).json(results);
  });
};

const getPublicProducts = async (req, res) => {
  try {
    /* =====================================
       PAGINATION
    ====================================== */
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    /* =====================================
       FILTERS
    ====================================== */
    const search = req.query.search?.trim() || '';
    const category = req.query.category;
    const sort = req.query.sort || 'latest';

    let where = `WHERE p.is_active = 1`;
    const params = [];

    /* =====================================
       SEARCH
    ====================================== */
    if (search) {
      where += ` AND p.name LIKE ?`;
      params.push(`%${search}%`);
    }

    /* =====================================
       CATEGORY FILTER (ID OR SLUG)
    ====================================== */
    if (category) {
      if (!isNaN(category)) {
        where += ` AND p.category_id = ?`;
        params.push(Number(category));
      } else {
        where += ` AND c.slug = ?`;
        params.push(category);
      }
    }

    /* =====================================
       SORTING
    ====================================== */
    let orderBy = `ORDER BY p.created_at DESC`;

    switch (sort) {
      case 'price_low':
        orderBy = `ORDER BY p.selling_price ASC`;
        break;

      case 'price_high':
        orderBy = `ORDER BY p.selling_price DESC`;
        break;

      case 'name_asc':
        orderBy = `ORDER BY p.name ASC`;
        break;

      case 'name_desc':
        orderBy = `ORDER BY p.name DESC`;
        break;

      case 'latest':
      default:
        orderBy = `ORDER BY p.created_at DESC`;
        break;
    }

    /* =====================================
       FETCH PRODUCTS
    ====================================== */
    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.description,
        p.selling_price,
        p.image_url,
        p.category_id,
        p.created_at,
        p.gst_rate, 
        c.name AS category_name,
        c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${where}
      ${orderBy}
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    /* =====================================
       COUNT TOTAL
    ====================================== */
    const [[countResult]] = await db.query(
      `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${where}
      `,
      params
    );

    /* =====================================
       RESPONSE
    ====================================== */
    return res.json({
      success: true,
      products: rows,
      total: countResult.total,
      page,
      limit,
      totalPages: Math.ceil(countResult.total / limit)
    });

  } catch (err) {
    console.error('Error fetching public products:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};




const getPublicProductById = async (req, res) => {
  try {
    const productId = req.params.id;

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.description,
        p.selling_price,
        p.selling_price_unit,
        p.image_url,
        p.gst_rate,
        p.stock,
        p.category_id,
        c.name AS category_name,
        c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
        AND p.is_active = 1
      `,
      [productId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    return res.json({
      success: true,
      product: rows[0]
    });

  } catch (error) {
    console.error('Error fetching public product:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product'
    });
  }
};






module.exports = {
  // Products
  getAllProducts,
  createProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  getPublicProducts,
  getPublicProductById,

  // Variants
  createVariant,
  getVariantByProductId,
  createVariantWithAttributes,
  getVariantsByProduct,

  // Variant attribute mapping
  addVariantAttributeValue,
  getAttributesForVariant,

  // Categories
  createCategory,
  updateCategory,
  deleteCategory,
  getCategories,
  getCategoryById,
  getCategoryByName,
  checkCategory,

  // Attributes
  createAttribute,
  getAllAttributes,
  deleteAttribute,
  updateAttribute,
  deleteAttributeOption,

  // Attribute Options
  createAttributeOption,
  getAttributeOptions,

  // Product–Attribute mapping
  assignAttributeToProduct,

  // Packaging
  addPackaging,
  addProductPackaging,
  getProductPackaging,
  addVariantPackaging,
  getVariantPackaging,
  removeProductPackaging,
  removeVariantPackaging
};

